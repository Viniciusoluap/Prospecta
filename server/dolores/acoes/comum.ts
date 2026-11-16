// EPIC-025 (Dolores, etapa 3) — peças comuns das AÇÕES. Regras fixas desta pasta (teste estático em acoes.test.ts):
// nunca excluir, nunca tocar em financeiro/banco/usuários/credenciais, nunca enviar nada a cliente ou terceiro. Cada ação
// chama as MESMAS funções de serviço das telas (server/db.ts, gerador de PCI), passando a transação de escrita mínima.
import type { z } from "zod";
import { textoDeDado, type MotivoContaminacao } from "../../../shared/dolores/fila.js";
import { sanitizarTexto } from "../../../shared/dolores/sanitizar.js";
import { tratarLinksDaResposta } from "../../../shared/dolores/links.js";
import { FILTRO_DO_REGISTRO, filtroDaSaida } from "../dados-pessoais.js";
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
  /**
   * Só na execução de um item APROVADO: o resumo que o dono leu (QA R2 N3). Todo texto livre que a execução grava tem de
   * estar nele, byte a byte (`conferirMostrado`); senão, nada é feito.
   */
  textoMostrado?: string;
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
    pedidoId: ctx.pedidoId?.slice(0, 120) ?? null, aprovacaoId: ctx.aprovacaoId,
    // o que vai para a tabela de autoria é REGISTRO: filtro com dados pessoais mascarados, qualquer que seja o interruptor
    descricao: sanitizarTexto(p.descricao, FILTRO_DO_REGISTRO).slice(0, 300),
  });
}

/** Marca de autoria que vai no próprio registro (texto), para quem abre a tela entender quem criou. */
export const MARCA_DOLORES = "Dolores (funcionária digital)";

/** Tamanho máximo do resumo de um item da fila: o dono lê TUDO o que será gravado (QA R2 N3). */
export const MAX_RESUMO_FILA = 1500;
export const FRASE_TEXTO_LONGO = "Texto longo demais para aprovar pelo WhatsApp (você precisa ler tudo o que será gravado): peça direto, numa mensagem curta, sem texto colado e sem consulta antes, ou encurte o texto. Nada foi posto na fila.";

/**
 * Forma do texto como o dono o vê no quadro e na tela: filtro de dados pessoais + uma linha, sem colchetes. É também a forma
 * em que o texto livre de um item da fila é guardado — o que é gravado na aprovação é exatamente o que foi mostrado.
 */
export const comoMostrado = (s: string | null | undefined) => textoDeDado(sanitizarTexto(String(s ?? ""), filtroDaSaida("whatsapp")), Number.MAX_SAFE_INTEGER);

/** URL do sistema (links permitidos na resposta ao dono, shared/dolores/links.ts). */
export const urlDoSistemaParaLinks = () => process.env.PUBLIC_SITE_URL?.trim() || null;
export const FRASE_TEXTO_COM_LINK = "O texto a gravar contém um link, e os links saem da mensagem que você lê: o que seria gravado ficaria diferente do que você leu. Reescreva sem o link. Nada foi feito nem posto na fila.";
export const FRASE_TEXTO_COM_SEGREDO = "O texto a gravar contém algo que o filtro de segurança esconde (senha, código de acesso, chave, dado bancário ou dado pessoal mascarado): o que seria gravado ficaria diferente do que você leu. Reescreva sem isso. Nada foi feito nem posto na fila.";
/** Motivo pelo qual a saída ao dono alteraria este texto (links tratados, filtro de saída do WhatsApp); null = intacto. */
export function textoAlteradoNaSaida(s: string): "link" | "segredo" | null {
  if (tratarLinksDaResposta(s, urlDoSistemaParaLinks()) !== s) return "link";
  if (sanitizarTexto(s, filtroDaSaida("whatsapp")) !== s) return "segredo";
  return null;
}
/**
 * Integração com a Etapa 2 (opção B): texto livre do DONO que será gravado (título, descrição, acompanhamento). Se a
 * remoção de links ou o filtro de saída o alterariam, a ação é RECUSADA — direta ou pela fila: nunca gravar algo diferente
 * do que o dono lê (regra N3). Intacto, volta como veio.
 */
export function textoDoDono(s: string): string {
  const alterado = textoAlteradoNaSaida(s);
  if (alterado) throw new RecusaAcao(alterado === "link" ? FRASE_TEXTO_COM_LINK : FRASE_TEXTO_COM_SEGREDO);
  return s;
}

/**
 * Resumo final de um item da fila (QA R2 N3): na forma mostrada, estável (mostrar de novo não muda nada), no máximo
 * MAX_RESUMO_FILA caracteres e contendo cada texto livre que será gravado (`trechos`). Senão, recusa — nunca corta em
 * silêncio.
 */
export function resumoDaFila(resumo: string, trechos: readonly string[] = []): string {
  const final = comoMostrado(resumo);
  if (final.length > MAX_RESUMO_FILA) throw new RecusaAcao(FRASE_TEXTO_LONGO);
  // o resumo inteiro (inclusive nomes e documentos do cadastro) tem de chegar ao dono sem a saída mexer nele
  const alterado = textoAlteradoNaSaida(final);
  if (alterado) throw new RecusaAcao(alterado === "link" ? FRASE_TEXTO_COM_LINK : FRASE_TEXTO_COM_SEGREDO);
  if (comoMostrado(final) !== final || trechos.some(t => !final.includes(t))) {
    throw new RecusaAcao("Não consegui mostrar o texto exatamente como seria gravado (dados pessoais ou formatação); nada foi posto na fila. Peça de novo com um texto simples.");
  }
  return final;
}

/** Na execução de um item aprovado: cada texto livre gravado tem de estar no resumo que o dono leu (QA R2 N3). */
export function conferirMostrado(ctx: ContextoAcao, trechos: readonly string[]) {
  if (ctx.textoMostrado === undefined) return;
  if (trechos.some(t => !ctx.textoMostrado!.includes(t))) {
    throw new RecusaAcao("O texto que seria gravado não é exatamente o que foi mostrado na aprovação; nada foi feito. Peça de novo.");
  }
}
