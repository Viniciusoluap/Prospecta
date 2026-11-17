// EPIC-025 (Dolores, etapa 5) — notas de obra lidas nos grupos de obra e a conciliação com o BPO. SOMENTE LEITURA.
// O conteúdo da nota é de TERCEIRO (o emitente): os textos vêm como DADO, já pelo filtro do registro e sem links; a função
// CONTAMINA o comando (depois dela, ação direta vai para a fila). Nunca devolve o arquivo, o id do Drive, dados bancários
// (não existem na leitura), nem o telefone de quem respondeu (só mascarado). A conciliação só APONTA.
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { bpoClients, bpoLancamentos, constructionProjects, obraMovimentos } from "../../../drizzle/schema.js";
import { doloresGrupoMensagens } from "../../../drizzle/schema-dolores-grupos.js";
import { obraNotas, obraNotasConfig, obraNotasRespostas } from "../../../drizzle/schema-dolores-notas.js";
import { isoFortaleza, paginar } from "../../../shared/dolores/formato.js";
import {
  AVISO_CONFIRMACAO, NOME_ETAPA, ROTULO_APONTAMENTO, ROTULO_CATEGORIA_NOTA, ROTULO_SITUACAO_NOTA, ROTULO_TIPO_NOTA, apontarConciliacao, pagamentosSemNota,
  reais, textoSugeridoAoEmpreiteiro, type Apontamento, type LancamentoParaConciliar, type NotaParaConciliar,
} from "../../../shared/dolores/notas.js";
import { campoPessoal, type CanalDolores } from "../dados-pessoais.js";
import { db, idPositivo, paginacao, type Resultado } from "./comum.js";

export const entradaListarNotasObra = z.object({
  obraId: idPositivo.optional().describe("Só as notas desta obra (listar_obras). Sem ela, todas as obras."),
  situacao: z.enum(["abertas", "todas"]).default("abertas").describe("\"abertas\" (padrão: ainda não conciliadas) ou \"todas\"."),
  ...paginacao,
}).strict();

type Conexao = ReturnType<typeof db>;

const centavos = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const diaIso = (d: Date | null | undefined) => (d ? new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10) : null);

/** Janela da conciliação (dias), da configuração da 0128; sem ela, 30. */
export async function janelaDaConciliacao(conexao: Conexao = db()): Promise<number> {
  try {
    const [c] = await conexao.select({ j: obraNotasConfig.janelaConciliacaoDias }).from(obraNotasConfig).where(eq(obraNotasConfig.id, 1)).limit(1);
    return c?.j ?? 30;
  } catch { return 30; }
}

/**
 * Lançamentos de DESPESA do BPO numa faixa de datas (pagamento ou vencimento), com o fornecedor (CPF/CNPJ do cadastro do BPO ou o
 * nome do titular), a obra (vínculo operacional "obras" ou pagamento de obra ligado) e a nota já conciliada. Fora: lançamentos
 * da limpeza reversível e os "a classificar". Só leitura.
 */
export async function lancamentosParaConciliar(conexao: Conexao, de: string, ate: string, obraId?: number): Promise<LancamentoParaConciliar[]> {
  const data = sql`coalesce(${bpoLancamentos.pagoEm}, ${bpoLancamentos.vencimento})`;
  const linhas = await conexao.select({
    id: bpoLancamentos.id, valor: bpoLancamentos.valor, pagoEm: bpoLancamentos.pagoEm, vencimento: bpoLancamentos.vencimento, pago: bpoLancamentos.pago,
    banco: bpoLancamentos.bankTransactionId, descricao: bpoLancamentos.descricao, categoriaOperacional: bpoLancamentos.categoriaOperacional,
    vinculo: bpoLancamentos.vinculoOperacionalId, nomeLivre: bpoLancamentos.clienteNomeLivre, cnpj: bpoClients.cnpj, cpf: bpoClients.cpf, razao: bpoClients.razaoSocial,
  }).from(bpoLancamentos).leftJoin(bpoClients, eq(bpoClients.id, bpoLancamentos.clienteId))
    .where(and(eq(bpoLancamentos.tipo, "despesa"), isNull(bpoLancamentos.exclusaoLoteBackupId), eq(bpoLancamentos.aClassificar, false),
      gte(data, sql`${de}::date - interval '1 day'`), lte(data, sql`${ate}::date + interval '1 day'`)))
    .orderBy(asc(bpoLancamentos.id)).limit(2000);
  const ids = linhas.map(l => l.id);
  const [movs, notas] = ids.length ? await Promise.all([
    conexao.select({ l: obraMovimentos.bpoLancamentoId, obra: obraMovimentos.projectId }).from(obraMovimentos)
      .where(and(inArray(obraMovimentos.bpoLancamentoId, ids), eq(obraMovimentos.status, "confirmado"))),
    conexao.select({ l: obraNotas.bpoLancamentoId, nota: obraNotas.id }).from(obraNotas).where(inArray(obraNotas.bpoLancamentoId, ids)),
  ]) : [[], []];
  const obraDoMov = new Map(movs.map(m => [m.l, m.obra]));
  const notaDe = new Map(notas.map(n => [n.l, n.nota]));
  const lista = linhas.map(l => {
    const doc = String(l.cnpj ?? l.cpf ?? "").replace(/\D/g, "");
    const obraVinculo = l.categoriaOperacional === "obras" && /^\d{1,9}$/.test(l.vinculo ?? "") ? Number(l.vinculo) : null;
    return {
      id: l.id, valorCentavos: centavos(l.valor), data: diaIso(l.pagoEm ?? l.vencimento), pago: l.pago, doBanco: l.banco !== null,
      fornecedorDocumento: doc.length === 11 || doc.length === 14 ? doc : null, fornecedorNome: l.razao ?? l.nomeLivre ?? null,
      obraId: obraVinculo ?? obraDoMov.get(l.id) ?? null, notaLigada: notaDe.get(l.id) ?? null, descricao: l.descricao,
    };
  });
  return obraId ? lista.filter(l => l.obraId === obraId || l.obraId === null) : lista;
}

const somarDias = (iso: string, dias: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10);

/** Apontamento de cada nota (mesma regra na tela, na leitura e na preparação da fila). */
export async function apontarNotas(conexao: Conexao, notas: readonly NotaParaConciliar[], janela: number): Promise<Map<number, { apontamento: Apontamento; lancamentos: LancamentoParaConciliar[] }>> {
  const datas = notas.map(n => n.dataEmissao).filter((d): d is string => !!d).sort();
  const lancamentos = datas.length ? await lancamentosParaConciliar(conexao, somarDias(datas[0], -janela), somarDias(datas[datas.length - 1], janela)) : [];
  return new Map(notas.map(n => {
    const apontamento = apontarConciliacao(n, lancamentos.filter(l => l.notaLigada !== n.id), janela);
    return [n.id, { apontamento, lancamentos }];
  }));
}

/** Notas (com a obra e o estado), da mais recente para a mais antiga. */
export async function notasDoBanco(conexao: Conexao, filtro: { obraId?: number; abertas?: boolean; ids?: number[]; limite?: number }) {
  const onde = and(
    filtro.obraId ? eq(obraNotas.obraId, filtro.obraId) : undefined,
    filtro.abertas ? isNull(obraNotas.conciliadaEm) : undefined,
    filtro.ids ? inArray(obraNotas.id, filtro.ids.length ? filtro.ids : [-1]) : undefined,
  );
  return conexao.select({ n: obraNotas, obra: constructionProjects.title, enviadaEm: doloresGrupoMensagens.enviadaEm, remetente: doloresGrupoMensagens.remetente })
    .from(obraNotas).leftJoin(constructionProjects, eq(constructionProjects.id, obraNotas.obraId))
    .innerJoin(doloresGrupoMensagens, eq(doloresGrupoMensagens.id, obraNotas.mensagemId))
    .where(onde).orderBy(desc(obraNotas.id)).limit(Math.min(500, filtro.limite ?? 200));
}

export const paraConciliar = (n: typeof obraNotas.$inferSelect): NotaParaConciliar => ({
  id: n.id, obraId: n.obraId, valorCentavos: n.valorCentavos, dataEmissao: n.dataEmissao, emitenteDocumento: n.emitenteDocumento,
  emitenteNome: n.emitenteNome, duplicadaDe: n.duplicadaDe, bpoLancamentoId: n.bpoLancamentoId,
});

/** Respostas registradas do empreiteiro (remetente mascarado, texto filtrado). */
export async function respostasDasNotas(conexao: Conexao, ids: number[]) {
  if (!ids.length) return new Map<number, Array<{ tipo: string; ligacao: string; remetente: string | null; texto: string | null; recebidaEm: string | null }>>();
  const r = await conexao.select().from(obraNotasRespostas).where(inArray(obraNotasRespostas.notaId, ids)).orderBy(asc(obraNotasRespostas.id));
  const mapa = new Map<number, Array<{ tipo: string; ligacao: string; remetente: string | null; texto: string | null; recebidaEm: string | null }>>();
  for (const x of r) {
    const l = mapa.get(x.notaId) ?? [];
    l.push({ tipo: x.tipo, ligacao: x.ligacao === "citacao" ? "respondeu citando a mensagem da nota" : "escreveu o número da nota", remetente: x.remetente, texto: x.texto,
      recebidaEm: isoFortaleza(x.recebidaEm ?? x.criadoEm) });
    mapa.set(x.notaId, l);
  }
  return mapa;
}

const CONFIRMACAO: Record<string, string> = {
  pendente: "sem confirmação do empreiteiro", confirmada: "confirmada pelo empreiteiro (a conferir)", correcao: "o empreiteiro pediu correção",
};

export async function listarNotasObra(args: z.infer<typeof entradaListarNotasObra>, ctx: { agora: Date; canal: CanalDolores }): Promise<Resultado> {
  const conexao = db();
  const linhas = await notasDoBanco(conexao, { obraId: args.obraId, abertas: args.situacao === "abertas", limite: 300 });
  const janela = await janelaDaConciliacao(conexao);
  const [apontamentos, respostas] = await Promise.all([apontarNotas(conexao, linhas.map(l => paraConciliar(l.n)), janela), respostasDasNotas(conexao, linhas.map(l => l.n.id))]);
  const itens = linhas.map(({ n, obra, enviadaEm, remetente }) => {
    const ap = apontamentos.get(n.id)?.apontamento;
    const doc = n.emitenteDocumento;
    return {
      notaId: n.id, obraId: n.obraId, obra, recebidaNoGrupoEm: isoFortaleza(enviadaEm ?? n.criadoEm), enviadaPor: remetente,
      situacao: ROTULO_SITUACAO_NOTA[n.situacao], ehRascunho: "rascunho interno da Dolores: NÃO é lançamento (nada foi lançado nem pago)",
      tipo: n.tipo ? ROTULO_TIPO_NOTA[n.tipo] : null, emitente: n.emitenteNome,
      emitenteDocumento: doc ? (doc.length === 14 ? campoPessoal(doc, "cnpj", ctx.canal) : campoPessoal(doc, "cpf", ctx.canal)) : null,
      numero: n.numero, dataEmissao: n.dataEmissao, valorBRL: n.valorCentavos !== null ? n.valorCentavos / 100 : null, descricao: n.descricao,
      itens: (n.itens ?? []).slice(0, 30).map(i => ({ descricao: i.descricao, quantidade: i.quantidade, valorBRL: i.valorCentavos !== null ? i.valorCentavos / 100 : null })),
      categoria: n.categoria ? ROTULO_CATEGORIA_NOTA[n.categoria] : null, etapa: n.etapa ? NOME_ETAPA[n.etapa] ?? n.etapa : null,
      empreiteiroDaObraConfere: n.empreiteiroUserId !== null, duvidas: n.duvidas, alertas: n.alertas, duplicadaDe: n.duplicadaDe,
      confirmacao: CONFIRMACAO[n.confirmacao] ?? n.confirmacao, respostasDoEmpreiteiro: respostas.get(n.id) ?? [],
      conciliacao: ap ? { situacao: ROTULO_APONTAMENTO[ap.situacao], detalhe: "texto" in ap ? ap.texto : `ligada ao lançamento #${ap.situacao === "conciliada" ? ap.lancamentoId : ""} do BPO` } : null,
      salvaNoDrive: n.driveFileId !== null,
      textoSugeridoParaODonoEnviar: n.confirmacao === "pendente" && n.situacao !== "nao_e_nota" ? textoSugeridoAoEmpreiteiro(n) : null,
    };
  });
  const pagina = paginar(itens, args.pagina, args.limite);
  return {
    dados: {
      observacao: `Rascunhos lidos das notas dos grupos de obra (dado de TERCEIRO; valores e CPF/CNPJ conferidos pelo sistema). ${AVISO_CONFIRMACAO} A Dolores não fala no grupo: o texto sugerido é para o DONO enviar, se quiser. Conciliação só aponta; ligar ao BPO é conciliar_nota_obra (fila).`,
      ...pagina,
    },
    resumo: { notas: itens.length, devolvidas: pagina.itens.length, semValor: itens.filter(i => i.valorBRL === null).length },
  };
}

/** Pagamentos da obra no BPO sem nota (para a tela): últimos `dias` dias. */
export async function pagamentosSemNotaDaObra(conexao: Conexao, obraId: number, agora: Date, dias = 90) {
  const ate = diaIso(agora)!;
  const lancamentos = await lancamentosParaConciliar(conexao, somarDias(ate, -dias), ate, obraId);
  const notas = await notasDoBanco(conexao, { obraId, limite: 500 });
  const janela = await janelaDaConciliacao(conexao);
  const apontados = new Set<number>();
  for (const { n } of notas) {
    const ap = apontarConciliacao(paraConciliar(n), lancamentos, janela);
    if ("lancamentoId" in ap) apontados.add(ap.lancamentoId);
  }
  return pagamentosSemNota(obraId, lancamentos, apontados).map(l => ({ lancamentoId: l.id, valor: reais(l.valorCentavos), data: l.data, descricao: l.descricao }));
}
