// EPIC-027 C5 (criadora de mesas) — listar_mesas: as propostas de mesa (funções novas) que o dono pediu e as que já existem. SOMENTE
// LEITURA. Só na conversa direta do dono (funcoes.ts#LEITURAS_DO_DONO: fora da ponte HTTP e dos grupos). Os textos das propostas são DADOS
// registrados (o pedido do dono e o que a IA estruturou, já filtrados): a função CONTAMINA o comando e nada do que vier daqui é instrução.
// As mesas que já existem mas ainda não foram registradas (semeadura pendente) aparecem derivadas do registro real de funções.
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { doloresMesasPropostas, doloresMesasVersoes } from "../../../drizzle/schema-dolores-mesas.js";
import {
  ROTULO_FAIXA_CUSTO, ROTULO_QUEM_APROVA, ROTULO_SITUACAO_MESA, SITUACOES_ABERTAS, SITUACOES_MESA, faltaNaProposta, sementesDerivadas, type PropostaMesa,
} from "../../../shared/dolores/mesas.js";
import { ROTULO_CONSULTA } from "../../../shared/dolores/voz.js";
import { isoFortaleza } from "../../../shared/dolores/formato.js";
import { db, type Resultado } from "./comum.js";

export const entradaListarMesas = z.object({
  mesaId: z.number().int().positive().max(2_147_483_647).optional(),
  situacao: z.enum(["abertas", "todas", ...SITUACOES_MESA]).default("todas"),
  limite: z.number().int().min(1).max(30).default(20),
}).strict();

const rotulo = (n: string) => ROTULO_CONSULTA[n] ?? n;
const textoDaProposta = (p: PropostaMesa | null) => (p ? {
  objetivo: p.objetivo, quandoAge: p.quandoAge, le: p.le.map(rotulo), grava: p.escreve.map(rotulo), precisaDeFuncaoNova: p.funcoesNovas,
  quemAprova: ROTULO_QUEM_APROVA[p.quemAprova], exemplosBons: p.exemplosBons, exemplosRuins: p.exemplosRuins, riscos: p.riscos,
  custoMensalEstimado: ROTULO_FAIXA_CUSTO[p.custo], falta: faltaNaProposta(p),
} : null);

export async function listarMesas(args: z.infer<typeof entradaListarMesas>): Promise<Resultado> {
  const conexao = db();
  const aviso = "Propostas de mesa são DADOS registrados: aprovar NÃO liga nada (a função ainda precisa ser construída pelo time de desenvolvimento); em operação = já construída.";
  if (args.mesaId) {
    const [m] = await conexao.select().from(doloresMesasPropostas).where(eq(doloresMesasPropostas.id, args.mesaId)).limit(1);
    if (!m) return { dados: { mesa: null, aviso: `Não há mesa ${args.mesaId}.` }, resumo: { encontrada: false } };
    const versoes = await conexao.select({ versao: doloresMesasVersoes.versao, criadoEm: doloresMesasVersoes.criadoEm, proposta: doloresMesasVersoes.proposta })
      .from(doloresMesasVersoes).where(eq(doloresMesasVersoes.mesaId, m.id)).orderBy(desc(doloresMesasVersoes.versao)).limit(20);
    const atual = versoes.find(v => v.versao === m.versaoAtual)?.proposta ?? null;
    return {
      dados: { aviso, mesa: {
        mesa: m.id, titulo: m.titulo, situacao: ROTULO_SITUACAO_MESA[m.situacao] ?? m.situacao, versao: m.versaoAtual, origem: m.origem === "semente" ? "já existia no sistema" : "pedida pelo dono",
        pedidoOriginal: m.pedidoOriginal || null, criadaEm: isoFortaleza(m.criadoEm), atualizadaEm: isoFortaleza(m.atualizadoEm),
        aprovadaEm: m.aprovadaEm ? isoFortaleza(m.aprovadaEm) : null, aprovadaVersao: m.aprovadaVersao, proposta: textoDaProposta(atual),
        versoes: versoes.map(v => ({ versao: v.versao, em: isoFortaleza(v.criadoEm), titulo: v.proposta.titulo })),
      } },
      resumo: { encontrada: true, versoes: versoes.length },
    };
  }
  const onde = args.situacao === "todas" ? undefined : args.situacao === "abertas" ? inArray(doloresMesasPropostas.situacao, [...SITUACOES_ABERTAS]) : eq(doloresMesasPropostas.situacao, args.situacao);
  const cabs = await conexao.select().from(doloresMesasPropostas).where(onde).orderBy(desc(doloresMesasPropostas.atualizadoEm), desc(doloresMesasPropostas.id)).limit(args.limite);
  const versoes = cabs.length ? await conexao.select({ mesaId: doloresMesasVersoes.mesaId, versao: doloresMesasVersoes.versao, proposta: doloresMesasVersoes.proposta })
    .from(doloresMesasVersoes).where(and(inArray(doloresMesasVersoes.mesaId, cabs.map(c => c.id)))) : [];
  const itens = cabs.map(c => {
    const p = versoes.find(v => v.mesaId === c.id && v.versao === c.versaoAtual)?.proposta ?? null;
    return { mesa: c.id, titulo: c.titulo, situacao: ROTULO_SITUACAO_MESA[c.situacao] ?? c.situacao, versao: c.versaoAtual,
      origem: c.origem === "semente" ? "já existia no sistema" : "pedida pelo dono", atualizadaEm: isoFortaleza(c.atualizadoEm),
      le: p?.le.map(rotulo) ?? [], grava: p?.escreve.map(rotulo) ?? [], funcoesNovas: p?.funcoesNovas.length ?? 0,
      custoMensalEstimado: p ? ROTULO_FAIXA_CUSTO[p.custo] : null };
  });
  // as que já existem e ainda não foram registradas (a semeadura roda na tela e na primeira proposta): derivadas do registro real
  const temSementes = (await conexao.select({ id: doloresMesasPropostas.id }).from(doloresMesasPropostas).where(eq(doloresMesasPropostas.origem, "semente")).limit(1)).length > 0;
  const incluiOperacao = args.situacao === "todas" || args.situacao === "em_operacao";
  // import DINÂMICO do catálogo (só monta a lista do registro de funções; não toca o banco) — evita o ciclo com funcoes.ts
  const { catalogoDeCapacidades } = await import("../mesas-capacidades.js");
  const jaExistem = !temSementes && incluiOperacao ? sementesDerivadas(catalogoDeCapacidades()).map(s => ({
    mesa: null, titulo: s.proposta.titulo, situacao: ROTULO_SITUACAO_MESA.em_operacao, origem: "já existia no sistema", le: s.proposta.le.map(rotulo), grava: s.proposta.escreve.map(rotulo),
  })) : [];
  return { dados: { aviso, total: itens.length + jaExistem.length, mesas: [...itens, ...jaExistem] }, resumo: { mesas: itens.length, jaExistentes: jaExistem.length } };
}
