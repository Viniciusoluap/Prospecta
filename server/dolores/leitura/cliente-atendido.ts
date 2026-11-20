// EPIC-025 (Dolores, etapa 9) — as ÚNICAS leituras do laço de resposta a CLIENTE CADASTRADO na conversa direta (regra do dono de
// 20/11/2026, item 4). SOMENTE LEITURA. O mesmo desenho da E4b (leitura/grupo-marcado.ts), que estas funções reutilizam:
// - O cliente vem do CONTEXTO do servidor (o lead identificado pelo telefone do remetente, de UM cadastro só), nunca de argumento:
//   as funções não têm argumento nenhum. Não há como pedir outro cliente, listar clientes nem buscar por nome.
// - Mesma LISTA DE CAMPOS PERMITIDOS do grupo (situação neutra, etapas, progresso, última movimentação, documentos pendentes pelo
//   nome), estendida para avaliação e incorporação (só a situação neutra e a data da última movimentação). Nunca saem valores,
//   dados pessoais, anotações da equipe, responsável, etapa comercial, resultado de aprovação, prazos previstos nem outro cliente.
// - O que é do GRUPO (arquivos recebidos no grupo) não existe aqui.
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { avaliacoes, incorporationUnits } from "../../../drizzle/schema.js";
import { diaFortaleza } from "../../../shared/dolores/formato.js";
import { situacaoNeutraDoGrupo } from "../../../shared/dolores/marcacao.js";
import { db, type Resultado } from "./comum.js";
import { andamentoDoGrupo, documentosPendentesDoGrupo, entradaSemArgumentos, proximosPassosDoGrupo, type ContextoDoGrupo } from "./grupo-marcado.js";

/** Contexto do SERVIDOR: o lead identificado pelo telefone do remetente (um cadastro só). */
export type ContextoDoCliente = { agora: Date; leadId: number };

/** Sem grupo: id impossível (as leituras do grupo que olham as mensagens do grupo não acham nada). */
const doGrupo = (ctx: ContextoDoCliente): ContextoDoGrupo => ({ agora: ctx.agora, grupoId: -1, leadId: ctx.leadId, obraId: null });

/** Avaliação e incorporação do lead: só o módulo, a situação neutra e a data (nunca valor, endereço, unidade ou preço). */
async function outrosModulos(leadId: number) {
  const [avs, unidades] = await Promise.all([
    db().select({ status: avaliacoes.status, updatedAt: avaliacoes.updatedAt }).from(avaliacoes).where(eq(avaliacoes.leadId, leadId)).limit(10),
    db().select({ status: incorporationUnits.status, updatedAt: incorporationUnits.updatedAt }).from(incorporationUnits)
      .where(and(eq(incorporationUnits.buyerLeadId, leadId), isNull(incorporationUnits.deletedAt))).limit(10),
  ]);
  return [
    ...avs.map(a => ({ modulo: "Avaliação", situacao: situacaoNeutraDoGrupo(String(a.status)), ultimaMovimentacao: diaFortaleza(a.updatedAt) })),
    ...unidades.map(u => ({ modulo: "Incorporação", situacao: situacaoNeutraDoGrupo(u.status), ultimaMovimentacao: diaFortaleza(u.updatedAt) })),
  ];
}

export async function andamentoDoCliente(_args: z.infer<typeof entradaSemArgumentos>, ctx: ContextoDoCliente): Promise<Resultado> {
  const [r, outros] = await Promise.all([andamentoDoGrupo({}, doGrupo(ctx)), outrosModulos(ctx.leadId)]);
  const dados = (r.dados ?? {}) as { processos?: unknown[]; cliente?: unknown; semVinculo?: boolean };
  if (dados.semVinculo) return { dados: { semCadastro: true, observacao: "Cadastro não encontrado." }, resumo: { vinculado: false } };
  const processos = [...(Array.isArray(dados.processos) ? dados.processos : []), ...outros];
  return {
    dados: {
      cliente: dados.cliente ?? null, processos,
      observacao: processos.length ? "Só situação (em análise, em andamento, aguardando dados, concluído, pausado ou encerrado), etapas e datas de movimento do caso desta pessoa. Prazos previstos, valores e resultado de aprovação não são informados." : "Nenhum processo registrado para esta pessoa.",
    },
    resumo: { vinculado: true, processos: processos.length },
  };
}

export async function documentosPendentesDoCliente(_args: z.infer<typeof entradaSemArgumentos>, ctx: ContextoDoCliente): Promise<Resultado> {
  const r = await documentosPendentesDoGrupo({}, doGrupo(ctx));
  const d = (r.dados ?? {}) as Record<string, unknown>;
  if (d.semVinculo) return { dados: { semCadastro: true, observacao: "Cadastro não encontrado." }, resumo: { vinculado: false } };
  return { dados: { pendentes: d.pendentes, documentosRecebidos: d.documentosRecebidos, observacao: d.observacao }, resumo: r.resumo };
}

export async function proximosPassosDoCliente(_args: z.infer<typeof entradaSemArgumentos>, ctx: ContextoDoCliente): Promise<Resultado> {
  const r = await proximosPassosDoGrupo({}, doGrupo(ctx));
  const d = (r.dados ?? {}) as { passos?: unknown; semVinculo?: boolean };
  if (d.semVinculo) return { dados: { semCadastro: true, observacao: "Cadastro não encontrado." }, resumo: { vinculado: false } };
  // o passo dos "arquivos enviados aqui no grupo" não existe na conversa direta
  const passos = (Array.isArray(d.passos) ? d.passos : []).filter(p => typeof p === "string" && !p.includes("no grupo"));
  return { dados: { passos }, resumo: { passos: passos.length } };
}
