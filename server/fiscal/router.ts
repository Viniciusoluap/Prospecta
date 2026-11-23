// EPIC-029 S-2 (22/11/2026) — rotas do fiscal, todas dentro da aba "Contabilidade" do BPO (decisão do dono k).
// Ver: admin e colaborador ATIVO com o módulo BPO (mapa `fiscal: "bpo"` em server/_core/trpc.ts).
// Decidir, editar, configurar e "Atualizar" (gerar rascunhos): só ADMIN por papel.
// S-7: emitir/cancelar/buscar alíquotas oficiais chamam a Sefin SÓ pelas funções de server/fiscal/emissao.ts e
// parametros-municipais.ts, com as travas de lá (EMISSAO_DISPONIVEL, interruptor por emissor, ambiente). DANFSe e XML: só admin.
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fiscalConfig, fiscalEmissores, fiscalTiposServico } from "../../drizzle/schema-fiscal.js";
import { MOTIVOS_SEM_NOTA } from "../../shared/fiscal/motivos.js";
import { ORIGENS_NOTA } from "../../shared/fiscal/origens.js";
import { STATUS_NOTA } from "../../shared/fiscal/status.js";
import { CODIGOS_ATIVIDADE_SIMPLES } from "../../shared/fiscal/dps-campos.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { ensureTaxSchema } from "../tax-router.js";
import { carregarConfigFiscal, gerarRascunhos } from "./gerador.js";
import { gerarDanfsePdf } from "./danfse.js";
import { cancelarNota, emitirNota, ErroEmissao, eventosDaNota, FRASE_PRODUCAO, fraseDeErroConhecido } from "./emissao.js";
import { buscarAliquotasOficiais, ErroParametros, escolherAliquota, listarParametros } from "./parametros-municipais.js";
import { fiscalNotas } from "../../drizzle/schema-fiscal.js";
import {
  adiar, carregarNota, cnpjLimpo, contarADecidir, editar, emissoresComPerfil, historicoDaNota, listarNotas, naoEmitir, opcoesDosFiltros, reabrir, CURSOR_NOTAS,
} from "./notas.js";
import { gerarPreviaPdf } from "./previa-pdf.js";
import { relatorioEmCsv, relatorioMensal } from "./relatorio-mensal.js";

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
/**
 * S-7: os XML (DPS assinada e NFS-e autorizada, com o CPF do tomador) e o retrato congelado NUNCA vão na lista/detalhe — o XML
 * sai só pelo download próprio (`notas.xml`, admin).
 */
function paraQuemVe<T extends { tomador: { documento: string | null }; xmlDps?: unknown; xmlNfse?: unknown; congelado?: unknown }>(nota: T, papel: string): Omit<T, "xmlDps" | "xmlNfse" | "congelado"> {
  const { xmlDps: _d, xmlNfse: _n, congelado: _c, ...resto } = nota;
  return papel === "admin" ? resto : { ...resto, tomador: { ...nota.tomador, documento: mascararCpf(nota.tomador.documento) } };
}
/** Erro conhecido da emissão (frase fixa, sem dado) → PRECONDITION_FAILED com a frase; o resto sobe (vira frase genérica). */
async function comFrase<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); }
  catch (e) {
    const frase = fraseDeErroConhecido(e) ?? (e instanceof ErroParametros ? e.message : null);
    if (frase) throw new TRPCError({ code: e instanceof ErroEmissao && e.tipo === "conflito" ? "CONFLICT" : "PRECONDITION_FAILED", message: frase });
    throw e;
  }
}
/** Código do leiaute (só números, curto): os parâmetros do contador nunca levam texto livre. */
const codigo = (max: number) => z.string().trim().regex(new RegExp(`^\\d{1,${max}}$`), "Código: só números.").nullable().optional();
const textoOpcional = (max: number) => z.string().trim().max(max).nullable().optional();
const ORIGEM_DO_MAPA = new RegExp(`^(${ORIGENS_NOTA.join("|")}):([a-z0-9_]{1,40}|\\*)$`);

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
    listar: fiscalProcedure.query(async () => {
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
        // Ambiente nasce "desligado"; muda só por `emissores.ambiente` (produção exige a frase digitada).
        const [salvo] = await db.insert(fiscalEmissores).values({ cnpj, ambiente: "desligado", criadoPor: ctx.user.id, ...valores })
          .onConflictDoUpdate({ target: fiscalEmissores.cnpj, set: valores }).returning();
        return salvo;
      }),

    /**
     * S-7: troca do ambiente do emissor. "producao" só com a frase "EMITIR EM PRODUÇÃO" digitada (conferida AQUI, não na tela).
     * O interruptor `emissao_liberada` NÃO é mexido aqui (nenhuma rota o liga nesta etapa).
     */
    ambiente: adminPorPapel
      .input(z.object({ emissorId: id, ambiente: z.enum(["desligado", "producao_restrita", "producao"]), frase: z.string().max(40).optional() }).strict())
      .mutation(async ({ input, ctx }) => {
        if (input.ambiente === "producao" && (input.frase ?? "").trim() !== FRASE_PRODUCAO) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Para emitir em produção (notas com valor fiscal), digite exatamente: ${FRASE_PRODUCAO}` });
        }
        const db = getDb();
        const emitindo = ((await db.execute(sql`SELECT 1 FROM fiscal_notas WHERE emissor_id = ${input.emissorId} AND status = 'EMITINDO' LIMIT 1`)) as { rows?: unknown[] }).rows ?? [];
        if (emitindo.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Há uma nota desta empresa sendo emitida. Resolva a emissão antes de trocar o ambiente." });
        const [salvo] = await db.update(fiscalEmissores).set({ ambiente: input.ambiente, atualizadoPor: ctx.user.id, atualizadoEm: new Date() })
          .where(eq(fiscalEmissores.id, input.emissorId)).returning();
        if (!salvo) throw new TRPCError({ code: "NOT_FOUND", message: "Empresa emissora não encontrada." });
        return salvo;
      }),
    /** S-7: parâmetros do contador que são da EMPRESA (códigos do leiaute; vazio = ainda não informado). */
    parametros: adminPorPapel
      .input(z.object({ emissorId: id, opSimpNac: codigo(1), regApTribSN: codigo(1), regEspTrib: codigo(1) }).strict())
      .mutation(async ({ input, ctx }) => {
        const [salvo] = await getDb().update(fiscalEmissores).set({
          parametrosDps: { opSimpNac: input.opSimpNac || null, regApTribSN: input.regApTribSN || null, regEspTrib: input.regEspTrib || null },
          atualizadoPor: ctx.user.id, atualizadoEm: new Date(),
        }).where(eq(fiscalEmissores.id, input.emissorId)).returning();
        if (!salvo) throw new TRPCError({ code: "NOT_FOUND", message: "Empresa emissora não encontrada." });
        return salvo;
      }),
  }),

  /** S-7: alíquotas oficiais do município (Sefin, só leitura, com o mTLS do emissor) e a escolha do admin. */
  parametrosMunicipais: router({
    listar: fiscalProcedure.input(z.object({ tipoServicoId: id.nullable().optional() }).optional()).query(({ input }) => listarParametros(getDb(), input?.tipoServicoId ?? null)),
    buscar: adminPorPapel
      .input(z.object({ emissorId: id, tipoServicoId: id, municipios: z.array(z.string().regex(/^\d{7}$/)).max(20).optional() }).strict())
      .mutation(({ input, ctx }) => comFrase(() => buscarAliquotasOficiais(getDb(), { ...input, usuarioId: ctx.user.id }))),
    escolher: adminPorPapel
      .input(z.object({ id, escolha: z.enum(["sefin", "digitada"]) }).strict())
      .mutation(({ input, ctx }) => comFrase(() => escolherAliquota(getDb(), { ...input, usuarioId: ctx.user.id }))),
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
    /** S-7: parâmetros do contador que são do SERVIÇO (códigos do leiaute; vazio = ainda não informado). */
    parametros: adminPorPapel
      .input(z.object({
        id, tribIssqn: codigo(1), tpRetIssqn: codigo(1), indTotTrib: codigo(1),
        ibscbs: z.object({ indFinal: codigo(1), cIndOp: codigo(6), indDest: codigo(1), cst: codigo(3), cClassTrib: codigo(6) }).strict().optional(),
      }).strict())
      .mutation(async ({ input, ctx }) => {
        const v = (x: string | null | undefined) => x || null;
        const [salvo] = await getDb().update(fiscalTiposServico).set({
          parametrosDps: { tribIssqn: v(input.tribIssqn), tpRetIssqn: v(input.tpRetIssqn), indTotTrib: v(input.indTotTrib),
            ibscbs: input.ibscbs ? { indFinal: v(input.ibscbs.indFinal), cIndOp: v(input.ibscbs.cIndOp), indDest: v(input.ibscbs.indDest), cst: v(input.ibscbs.cst), cClassTrib: v(input.ibscbs.cClassTrib) } : null },
          atualizadoPor: ctx.user.id, atualizadoEm: new Date(),
        }).where(eq(fiscalTiposServico.id, input.id)).returning();
        if (!salvo) throw new TRPCError({ code: "NOT_FOUND", message: "Tipo de serviço não encontrado." });
        return salvo;
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
    /** PDF da prévia em base64 (marca d'água "RASCUNHO — SEM VALOR FISCAL" em todas as páginas). */
    previa: fiscalProcedure.input(z.object({ id })).query(async ({ input, ctx }) => {
      const nota = { ...paraQuemVe(await carregarNota(getDb(), input.id), ctx.user.role), xmlDps: null, xmlNfse: null, congelado: null };
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
    /**
     * S-7: emitir pela Sefin Nacional — só com as três travas abertas (EMISSAO_DISPONIVEL, interruptor do emissor, ambiente).
     * Repetir o pedido nunca gera outra nota (Id da DPS fixo + consulta antes de reenviar).
     */
    emitir: adminPorPapel.input(z.object({ id, versao: z.number().int().positive() }))
      .mutation(({ input, ctx }) => comFrase(() => emitirNota(getDb(), { ...input, usuarioId: ctx.user.id, via: "tela" }))),
    /** S-7: cancelar (e101101) — motivo 1/2/9 e justificativa de 15 a 255 caracteres. */
    cancelar: adminPorPapel
      .input(z.object({ id, versao: z.number().int().positive(), motivo: z.union([z.literal(1), z.literal(2), z.literal(9)]), justificativa: z.string().trim().min(15).max(255) }).strict())
      .mutation(({ input, ctx }) => comFrase(() => cancelarNota(getDb(), { ...input, usuarioId: ctx.user.id, via: "tela" }))),
    /** S-7: eventos da emissão (sem XML). */
    eventos: fiscalProcedure.input(z.object({ id })).query(({ input }) => eventosDaNota(getDb(), input.id)),
    /** S-7: DANFSe do XML AUTORIZADO (só admin; nunca do rascunho). */
    danfse: adminPorPapel.input(z.object({ id })).query(async ({ input }) => {
      const [n] = await getDb().select({ status: fiscalNotas.status, xml: fiscalNotas.xmlNfse, numero: fiscalNotas.numeroNfse }).from(fiscalNotas).where(eq(fiscalNotas.id, input.id)).limit(1);
      if (!n || !n.xml || (n.status !== "EMITIDA" && n.status !== "CANCELADA")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "O DANFSe só existe para nota emitida (o rascunho tem a prévia)." });
      return { nomeArquivo: `danfse-${n.numero ?? input.id}.pdf`, base64: Buffer.from(gerarDanfsePdf(n.xml, { cancelada: n.status === "CANCELADA" })).toString("base64") };
    }),
    /** S-7: XML autorizado (só admin). */
    xml: adminPorPapel.input(z.object({ id })).query(async ({ input }) => {
      const [n] = await getDb().select({ status: fiscalNotas.status, xml: fiscalNotas.xmlNfse, numero: fiscalNotas.numeroNfse }).from(fiscalNotas).where(eq(fiscalNotas.id, input.id)).limit(1);
      if (!n || !n.xml || (n.status !== "EMITIDA" && n.status !== "CANCELADA")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Só a nota emitida tem XML autorizado." });
      return { nomeArquivo: `nfse-${n.numero ?? input.id}.xml`, xml: n.xml };
    }),
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
});
