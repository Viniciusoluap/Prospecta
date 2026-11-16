// EPIC-025 (Dolores, etapa 3) — peças comuns das AÇÕES. Regras fixas desta pasta (teste estático em acoes.test.ts):
// nunca excluir, nunca tocar em financeiro/banco/usuários/credenciais, nunca enviar nada a cliente ou terceiro. Cada ação
// chama as MESMAS funções de serviço das telas (server/db.ts, gerador de PCI), passando a transação de escrita mínima.
import type { z } from "zod";
import type { MotivoContaminacao } from "../../../shared/dolores/fila.js";
import { doloresAutoria } from "../../../drizzle/schema-dolores-fila.js";
import type { Resultado } from "../leitura/comum.js";
import { bancoDaAcao } from "../escrita.js";

/** Nível de cada ação (seção 5 do prompt mestre): `direto` = execução direta com registro; `fila` = espera o dono. */
export type NivelAcao = "direto" | "fila";

export type ContextoAcao = {
  agora: Date;
  /** A usuária Dolores (autora de tudo o que for criado). */
  autorId: number;
  /** A mensagem do dono no WhatsApp que originou a ação (na fila: a que originou o item). */
  mensagemId: number | null;
  /** Mesmo `pedido_id` gravado em dolores_acoes. */
  pedidoId: string | null;
  /** Item da fila aprovado (só na execução de um item aprovado). */
  aprovacaoId: number | null;
  /** Tempo que ainda resta (ms) para terminar a execução de um item aprovado pelo WhatsApp (prazo da Vercel). */
  tempoRestanteMs?: () => number;
  /** Por que o comando está contaminado (o aviso do item na fila): leu dados ou a mensagem parece texto colado. */
  motivoContaminacao?: MotivoContaminacao | null;
};

/** O pedido não pode ser feito (cliente não existe, nada pendente…): recusa explicada, auditada como "recusada". */
export class RecusaAcao extends Error {
  /**
   * A explicação traz texto vindo do BANCO (nomes da equipe, mensagem do gerador…)? Então ela contamina o comando
   * (QA R2 N2): depois dela, nenhuma ação direta roda. Padrão: texto fixo do sistema (só ids e números).
   */
  readonly comDados: boolean;
  constructor(motivo: string, opcoes: { comDados?: boolean } = {}) { super(motivo); this.name = "RecusaAcao"; this.comDados = opcoes.comDados === true; }
}

export type ResultadoAcao = Resultado & {
  /** Frases curtas do que foi gravado (vão ao dono no quadro "Registrado no sistema por mim"). */
  feitos?: string[];
};

export type ItemParaFila = { alvo: string; resumo: string; argumentos: Record<string, unknown> };
export type Preparo = { itens: ItemParaFila[]; recusados: Array<{ alvo: string; motivo: string }> };

export type FuncaoAcao = {
  nome: string;
  descricao: string;
  tipo: "acao";
  nivel: NivelAcao;
  /** A resposta desta ação ao modelo traz texto de dados (nomes, documentos)? Então contamina o comando (ver funcoes.ts). */
  contamina: boolean;
  entrada: z.ZodType;
  /** `direto`: executa dentro da transação de escrita. */
  executar?: (args: never, ctx: ContextoAcao) => Promise<ResultadoAcao>;
  /**
   * `direto`: resumo legível do pedido para a FILA, quando a ação foi pedida depois de o comando ler dados do sistema
   * (regra de contaminação): não grava nada; a execução, aprovada, roda `executarAprovado` (= `executar` numa transação).
   */
  paraFila?: (args: never, ctx: ContextoAcao) => Promise<ItemParaFila>;
  /** `fila`: confere tudo e devolve o que vai para a fila (não grava nada no sistema). */
  preparar?: (args: never, ctx: ContextoAcao) => Promise<Preparo>;
  /** Argumentos guardados no item da fila, validados DE NOVO na hora de executar. */
  entradaAprovada?: z.ZodType;
  /** Executa um item aprovado da fila, revalidando o estado atual. */
  executarAprovado?: (args: never, ctx: ContextoAcao) => Promise<ResultadoAcao>;
  /** O item aprovado roda na transação de escrita mínima? (o gerador de PCI grava pelas próprias funções) */
  aprovadoEmTransacao?: boolean;
};

/** Autoria: o registro criado pela Dolores, ligado ao pedido e ao item aprovado. Sempre na mesma transação da gravação. */
export async function registrarAutoria(ctx: ContextoAcao, p: { tabela: string; registroId: number; funcao: string; descricao: string }) {
  await bancoDaAcao().insert(doloresAutoria).values({
    autorUserId: ctx.autorId, tabela: p.tabela, registroId: p.registroId, funcao: p.funcao, mensagemId: ctx.mensagemId,
    pedidoId: ctx.pedidoId?.slice(0, 120) ?? null, aprovacaoId: ctx.aprovacaoId, descricao: p.descricao.slice(0, 300),
  });
}

/** Marca de autoria que vai no próprio registro (texto), para quem abre a tela entender quem criou. */
export const MARCA_DOLORES = "Dolores (funcionária digital)";
