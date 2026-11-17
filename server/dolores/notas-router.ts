// EPIC-025 (Dolores, etapa 5) — rotas `dolores.notas.*`: notas de obra lidas nos grupos de obra (rascunhos), configuração da
// leitura, leitura das pendentes pela tela e PROPOSTAS para a fila de aprovação. SÓ o administrador (PAPEL), conferido em cada
// procedimento (o adminProcedure só confere o MÓDULO). Regras:
// - nada aqui grava em obra, BPO ou Drive: a tela só LÊ, configura a leitura e PROPÕE itens à fila (o dono aprova na fila);
// - nada aqui envia mensagem a ninguém: o texto sugerido ao empreiteiro é para o dono enviar;
// - a leitura pela tela passa pelas MESMAS travas do webhook (interruptores, porta da chave, tetos, orçamento, uma por vez).
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { doloresGrupoMensagens, doloresGrupos } from "../../drizzle/schema-dolores-grupos.js";
import { obraNotasConfig } from "../../drizzle/schema-dolores-notas.js";
import {
  AVISO_CONFIRMACAO, NOME_ETAPA, ROTULO_APONTAMENTO, ROTULO_CATEGORIA_NOTA, ROTULO_SITUACAO_NOTA, ROTULO_TIPO_NOTA, documentoParaMostrar, textoSugeridoAoEmpreiteiro,
} from "../../shared/dolores/notas.js";
import { textoDeDado } from "../../shared/dolores/fila.js";
import { isoFortaleza } from "../../shared/dolores/formato.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { acaoPorNome } from "./acoes/registro.js";
import { RecusaAcao, type ContextoAcao } from "./acoes/comum.js";
import { porNaFila } from "./aprovacoes.js";
import { registrarAcao } from "./auditoria.js";
import { TEXTO_VINCULO_PERDIDO, apontarNotas, janelaDaConciliacao, notasDoBanco, pagamentosSemNotaDaObra, paraConciliar, respostasDasNotas, vinculoPerdido } from "./leitura/notas.js";
import { CONFIG_NOTAS_PADRAO, lerConfigNotas, lerNotasPendentes } from "./notas-obra.js";
import { funcaoLiberada } from "./permissoes.js";
import { DoloresDesativada, usuarioDolores } from "./perfil.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "./somente-leitura.js";
import { credencialDaLeituraDeNota } from "./whatsapp.js";

/** adminProcedure confere o módulo; aqui vale o PAPEL: só admin. */
const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador vê e configura as notas de obra da Dolores." });
  return next();
});

const SEM_MIGRACAO = "Notas de obra indisponíveis: a migração 0128 ainda não foi aplicada.";
const semMigracao = (e: unknown): never => {
  if (e instanceof TRPCError) throw e;
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
};
const id32 = z.number().int().positive().max(2_147_483_647);
const CONFIRMACAO: Record<string, string> = {
  pendente: "sem confirmação do empreiteiro", confirmada: "confirmada pelo empreiteiro (a conferir)", correcao: "o empreiteiro pediu correção",
};

// a autora do item da fila é a usuária Dolores; o admin que pediu vai no resumo da auditoria (sem FK: excluir o usuário depois funciona)
const auditar = (userId: number, funcao: string, resultado: "ok" | "recusada", motivo: string | null, resumo: Record<string, unknown>) =>
  registrarAcao({ funcao, resultado, motivo, autorUserId: null, canal: "tela", pedidoId: `tela:notas:${String(resumo.notaId ?? "config")}`, resumo: { porUserId: userId, ...resumo } });

async function propor(funcao: "conciliar_nota_obra" | "salvar_nota_obra", args: Record<string, unknown>, userId: number) {
  const fn = acaoPorNome(funcao);
  if (!fn?.preparar || !funcaoLiberada(funcao)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Função não liberada na etapa atual." });
  const entrada = fn.entrada.safeParse(args);
  if (!entrada.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Dados inválidos." });
  let autorId: number;
  try { autorId = await usuarioDolores(); }
  catch (e) { throw new TRPCError({ code: "PRECONDITION_FAILED", message: e instanceof DoloresDesativada ? "A usuária Dolores está desativada." : "Usuária Dolores indisponível." }); }
  const ctx: ContextoAcao = { agora: new Date(), autorId, mensagemId: null, pedidoId: `tela:notas:${String(args.notaId)}`, aprovacaoId: null };
  try {
    const preparo = await fn.preparar(entrada.data as never, ctx);
    const itens = await porNaFila(funcao, preparo, ctx);
    await auditar(userId, funcao, "ok", "proposto pela tela: aguarda a aprovação do dono na fila", { notaId: args.notaId, codigos: itens.map(i => i.codigo) });
    return { itens: itens.map(i => ({ codigo: i.codigo, resumo: i.resumo, jaAguardava: i.jaAguardava })) };
  } catch (e) {
    if (e instanceof RecusaAcao) {
      await auditar(userId, funcao, "recusada", e.message.slice(0, 300), { notaId: args.notaId });
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    }
    return semMigracao(e);
  }
}

export const notasRouter = router({
  /** Notas (rascunhos) com conferências, resposta do empreiteiro e apontamento da conciliação; pendências de leitura. */
  listar: soAdmin.input(z.object({ obraId: id32.optional(), situacao: z.enum(["abertas", "todas"]).default("todas") }).strict().optional()).query(async ({ input }) => {
    try {
      const config = await lerConfigNotas();
      return await emTransacaoSomenteLeitura(async () => {
        const conexao = bancoDaLeitura();
        const linhas = await notasDoBanco(conexao, { obraId: input?.obraId, abertas: input?.situacao === "abertas", limite: 200 });
        const janela = await janelaDaConciliacao(conexao);
        const apontamentos = await apontarNotas(conexao, linhas.map(l => paraConciliar(l.n)), janela);
        const respostas = await respostasDasNotas(conexao, linhas.map(l => l.n.id));
        const [pend] = await conexao.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(doloresGrupoMensagens)
          .innerJoin(doloresGrupos, eq(doloresGrupos.id, doloresGrupoMensagens.grupoId))
          .where(and(eq(doloresGrupos.ativo, true), isNotNull(doloresGrupos.obraId), inArray(doloresGrupoMensagens.situacao, ["a_classificar", "classificando", "erro"])));
        const semNota = input?.obraId ? await pagamentosSemNotaDaObra(conexao, input.obraId, new Date()) : [];
        return {
          aviso: AVISO_CONFIRMACAO, config: { ...CONFIG_NOTAS_PADRAO, ...config }, pendentesDeLeitura: Number(pend?.n ?? 0), pagamentosSemNota: semNota,
          notas: linhas.map(({ n, obra, enviadaEm, remetente }) => {
            const ap = apontamentos.get(n.id)?.apontamento;
            return {
              id: n.id, obraId: n.obraId, obra: obra ? textoDeDado(obra, 120) : null, recebidaEm: isoFortaleza(enviadaEm ?? n.criadoEm), enviadaPor: remetente,
              situacao: n.situacao, rotuloSituacao: ROTULO_SITUACAO_NOTA[n.situacao], tipo: n.tipo ? ROTULO_TIPO_NOTA[n.tipo] : null,
              emitente: n.emitenteNome, documento: documentoParaMostrar(n.emitenteDocumento), numero: n.numero, dataEmissao: n.dataEmissao,
              valorCentavos: n.valorCentavos, descricao: n.descricao, itens: n.itens, chaveAcesso: n.chaveAcesso,
              categoria: n.categoria ? ROTULO_CATEGORIA_NOTA[n.categoria] : null, etapa: n.etapa ? NOME_ETAPA[n.etapa] ?? n.etapa : null,
              empreiteiroConfere: n.empreiteiroUserId !== null, confianca: n.confianca, duvidas: n.duvidas, alertas: n.alertas, duplicadaDe: n.duplicadaDe,
              confirmacao: n.confirmacao, rotuloConfirmacao: CONFIRMACAO[n.confirmacao], respostas: respostas.get(n.id) ?? [],
              conciliacao: ap ? { situacao: ap.situacao, rotulo: ROTULO_APONTAMENTO[ap.situacao], texto: "texto" in ap ? ap.texto : `ligada ao lançamento #${"lancamentoId" in ap ? ap.lancamentoId : ""} do BPO`,
                podeConciliar: ap.situacao === "ja_lancado" && ap.podeConciliar } : null,
              conciliadaCom: n.bpoLancamentoId, vinculoPerdido: vinculoPerdido(n) ? TEXTO_VINCULO_PERDIDO : null, salvaNoDrive: n.driveFileId !== null,
              textoSugerido: n.confirmacao === "pendente" && n.situacao !== "nao_e_nota" ? textoSugeridoAoEmpreiteiro(n) : null,
            };
          }),
        };
      });
    } catch (e) { return semMigracao(e); }
  }),

  /** Configuração da leitura de notas (nasce DESLIGADA). */
  salvarConfig: soAdmin.input(z.object({
    leituraLigada: z.boolean().optional(),
    prazoConfirmacaoDias: z.number().int().min(1).max(60).optional(),
    janelaConciliacaoDias: z.number().int().min(1).max(120).optional(),
  }).strict()).mutation(async ({ ctx, input }) => {
    const r = await getDb().update(obraNotasConfig).set({ ...input, atualizadoEm: new Date(), atualizadoPor: ctx.user.id })
      .where(eq(obraNotasConfig.id, 1)).returning({ id: obraNotasConfig.id }).catch(semMigracao);
    if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
    await auditar(ctx.user.id, "configurar_notas_obra", "ok", null, input);
    return lerConfigNotas();
  }),

  /** Lê agora até 3 notas pendentes dos grupos de obra, pelas MESMAS travas do webhook. Não envia nada a ninguém. */
  lerPendentes: soAdmin.input(z.object({ maximo: z.number().int().min(1).max(3).default(1) }).strict().optional()).mutation(async ({ input }) => {
    const contagem = await lerNotasPendentes({ maximo: input?.maximo ?? 1, prazoFinal: Date.now() + 45_000, obterCredencial: credencialDaLeituraDeNota, canal: "tela" })
      .catch(semMigracao);
    return { contagem };
  }),

  /** Propõe à FILA ligar a nota ao pagamento do BPO (o dono aprova na fila; nada é gravado aqui). */
  proporConciliacao: soAdmin.input(z.object({ notaId: id32, lancamentoId: id32.optional() }).strict()).mutation(({ ctx, input }) => propor("conciliar_nota_obra", input, ctx.user.id)),

  /** Propõe à FILA salvar o arquivo da nota na pasta da obra no Drive. */
  proporSalvar: soAdmin.input(z.object({ notaId: id32 }).strict()).mutation(({ ctx, input }) => propor("salvar_nota_obra", input, ctx.user.id)),
});
