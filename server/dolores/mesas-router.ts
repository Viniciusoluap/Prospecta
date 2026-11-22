// EPIC-027 C5 (criadora de mesas) — rotas `dolores.mesas.*`: a seção "Mesas" do cartão de operação da Dolores. SÓ o administrador (PAPEL),
// conferido em cada procedimento ANTES de qualquer consulta (o adminProcedure só confere o MÓDULO). A tela mostra as propostas completas (com
// as versões) e o texto em Markdown pronto para o time de desenvolvimento ("Copiar para o desenvolvimento" — nada é escrito em disco nem no
// repositório). Pela tela só se muda a situação para em construção, em operação ou arquivada; aprovar e recusar são do DONO, na conversa.
// Mudar a situação não liga nada (a função é construída pelo processo normal). Toda mudança vai para a auditoria (dolores_acoes "mesa").
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ROTULO_SITUACAO_MESA, SITUACOES_MESA, faltaNaProposta, markdownDaMesa, podeMudarPelaTela, type SituacaoDaTela, type SituacaoMesa,
} from "../../shared/dolores/mesas.js";
import { ROTULO_CONSULTA } from "../../shared/dolores/voz.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { SEM_MIGRACAO_MESAS, auditarMesa, lerMesa, listarMesas, mudarSituacaoMesa, semTabelaDasMesas, semearMesasIniciais, versoesDaMesa } from "./mesas.js";
import { catalogoDeCapacidades } from "./mesas-capacidades.js";

/** adminProcedure confere o módulo; aqui vale o PAPEL: só admin (antes de qualquer leitura). */
const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador vê e acompanha as mesas da Dolores." });
  return next();
});

async function noBanco<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof TRPCError) throw e;
    if (semTabelaDasMesas(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO_MESAS });
    console.error("[dolores/mesas] falha na tela", e instanceof Error ? e.name : "erro");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não consegui ler ou gravar agora; nada mudou. Tente de novo." });
  }
}

const id32 = z.number().int().positive().max(2_147_483_647);
const rotulo = (n: string) => ROTULO_CONSULTA[n] ?? n;
const COM_MARKDOWN: readonly SituacaoMesa[] = ["aprovada", "em_construcao", "em_operacao"];

export const mesasRouter = router({
  listar: soAdmin.input(z.object({
    situacao: z.enum(["abertas", "todas", ...SITUACOES_MESA]).default("todas"), limite: z.number().int().min(1).max(200).default(100),
  }).strict()).query(({ input }) => noBanco(async () => {
    // as mesas que já existem entram na primeira vez (idempotente, derivadas do registro real de funções)
    await semearMesasIniciais(catalogoDeCapacidades(), new Date());
    const linhas = await listarMesas(input);
    return linhas.map(m => ({
      id: m.id, titulo: m.titulo, situacao: m.situacao, rotuloSituacao: ROTULO_SITUACAO_MESA[m.situacao] ?? m.situacao, versao: m.versaoAtual, origem: m.origem,
      pedidoOriginal: m.pedidoOriginal, criadoEm: m.criadoEm, atualizadoEm: m.atualizadoEm, aprovadaEm: m.aprovadaEm, aprovadaVersao: m.aprovadaVersao,
      proposta: m.proposta, le: m.proposta?.le.map(n => ({ nome: n, rotulo: rotulo(n) })) ?? [], escreve: m.proposta?.escreve.map(n => ({ nome: n, rotulo: rotulo(n) })) ?? [],
      falta: m.proposta ? faltaNaProposta(m.proposta) : [],
      markdown: m.proposta && COM_MARKDOWN.includes(m.situacao)
        ? markdownDaMesa({ id: m.id, situacao: m.situacao, versao: m.versaoAtual, pedidoOriginal: m.pedidoOriginal, origem: m.origem, criadoEm: m.criadoEm,
          aprovadaEm: m.aprovadaEm, aprovadaVersao: m.aprovadaVersao, proposta: m.proposta, rotulo })
        : null,
    }));
  })),

  versoes: soAdmin.input(z.object({ id: id32 }).strict()).query(({ input }) => noBanco(async () => {
    const vs = await versoesDaMesa(input.id);
    return vs.map(v => ({ versao: v.versao, criadoEm: v.criadoEm, origem: v.origem, proposta: v.proposta }));
  })),

  mudarSituacao: soAdmin.input(z.object({ id: id32, para: z.enum(["em_construcao", "em_operacao", "arquivada"]) }).strict())
    .mutation(({ ctx, input }) => noBanco(async () => {
      const m = await lerMesa(input.id);
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Mesa não encontrada." });
      const para = input.para as SituacaoDaTela;
      if (!podeMudarPelaTela(m.situacao, para)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `A mesa está ${ROTULO_SITUACAO_MESA[m.situacao]}: não vai para ${ROTULO_SITUACAO_MESA[para]} pela tela (aprovar e recusar são do dono, na conversa).` });
      }
      const ok = await mudarSituacaoMesa(m.id, [m.situacao], para, { por: ctx.user.id, agora: new Date(), versao: m.versaoAtual });
      if (!ok) throw new TRPCError({ code: "CONFLICT", message: "A mesa mudou enquanto você olhava; recarregue e tente de novo." });
      await auditarMesa({ resultado: "ok", motivo: `situação mudada pela tela: ${m.situacao} → ${para}`, canal: "tela", autor: ctx.user.id, mesaId: m.id,
        resumo: { operacao: "situacao", de: m.situacao, para } });
      return { id: m.id, situacao: para };
    })),
});
