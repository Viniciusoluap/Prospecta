// Maquete 3D (EPIC-024, correções do QA de S-03/S-05) — o que protege o gasto com a IA, comum à leitura e à importação:
//   - gravação condicional: cada passo só grava se a coluna (leitura ou importação) ainda tiver o texto que ele leu;
//     quem chegou atrasado (outra aba, importação já aplicada ou descartada, leitura recomeçada) não regrava nada;
//   - reserva da chamada paga: ANTES de chamar a IA, o passo vira "executando" num UPDATE condicional que também soma
//     o contador da maquete (com o teto na própria condição). Duas abas ao mesmo tempo: só uma reserva, só uma chamada;
//   - confirmação por execução: vale só para esta leitura/importação e para N chamadas; expira ao chegar a N;
//   - teto por maquete (`limitePranchasIA`), somando leituras e importações; passar dele só com o "além do teto" do admin.
// Sem transação interativa (neon-http): tudo é UPDATE ... WHERE ... RETURNING.
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { maquetes3d, type Maquete3d } from "../../drizzle/schema-maquete-3d.js";
import { confirmacaoDoModelo, confirmacaoValida, type ConfigMaquete, type EstadoLeitura, type PassoLeitura, type StatusMaquete } from "../../shared/maquete-3d/regras.js";
import { LIMITE_PASSO_MS, LeituraIndisponivel, agora, db, dependencias, modeloDaLeitura, tipoDoErroIA, type CredencialIA } from "./base.js";

/** Passos do fluxo antigo (motor "IA em tudo"): cada um é uma chamada paga com os PDFs inteiros. */
export const PASSOS_IA_ANTIGOS: readonly PassoLeitura["tipo"][] = ["inventario", "estrutura", "ambientes", "implantacao"];

/** Reserva com mais tempo que isto (o limite da função é 60 s) é de um passo interrompido. */
export const LIMITE_RESERVA_MS = 75_000;

/** A chamada já foi reservada por outra aba (ou a leitura mudou): este pedido não chama a IA e não grava nada. */
export class ExecucaoConcorrente extends Error {}

/** Onde a execução guarda o estado: a coluna `leitura` (leitura principal) ou `importacao` (planta importada). */
export type Execucao = {
  id: number;
  coluna: "leitura" | "importacao";
  /** Texto da coluna como foi lido (atualizado depois da reserva): é a condição de toda gravação. */
  lido: string | null;
  /** Texto novo da coluna para este estado. */
  serializar: (e: EstadoLeitura) => string;
  /** Situações da maquete em que esta execução pode gravar. */
  status: readonly StatusMaquete[];
  /** Contador da maquete (chamadas pagas já feitas, leituras + importações). */
  iaLidas: number;
  /** Chamadas reservadas que não chegaram a ser cobradas (erro antes da resposta): devolvidas na gravação final. */
  devolver: number;
  /** A reserva feita por este pedido (passo, hora e tokens antes da chamada): base da segunda barreira do N1. */
  reserva?: { chave: string; em: string; tokensEntrada: number; tokensSaida: number };
  /** Quando este pedido começou (Date.now()): o orçamento da função (60 s) conta daqui (QA rodada 2, N7). */
  inicio: number;
};

export const execucaoDe = (m: Maquete3d, coluna: Execucao["coluna"], serializar: Execucao["serializar"], status: readonly StatusMaquete[], inicio = Date.now()): Execucao => ({
  id: m.id, coluna, lido: coluna === "leitura" ? m.leitura : m.importacao, serializar, status, iaLidas: m.iaPranchasLidas ?? 0, devolver: 0, inicio,
});

/**
 * Grava `novo` na coluna da execução só se ela ainda tiver o texto lido (e a maquete estiver numa das situações).
 * `deltaIA` soma ao contador; `limiteIA` (com delta positivo) entra na condição: o teto não é passado nem em corrida.
 */
export async function gravarSeIgual(x: Execucao, novo: string | null, p: { deltaIA?: number; limiteIA?: number | null; extra?: Partial<typeof maquetes3d.$inferInsert> } = {}): Promise<boolean> {
  const coluna = x.coluna === "leitura" ? maquetes3d.leitura : maquetes3d.importacao;
  const delta = p.deltaIA ?? 0;
  const r = await db().update(maquetes3d)
    .set({
      ...p.extra, [x.coluna]: novo, updatedAt: agora(),
      ...(delta ? { iaPranchasLidas: sql`greatest(0, ${maquetes3d.iaPranchasLidas} + ${delta})` } : {}),
    })
    .where(and(
      eq(maquetes3d.id, x.id), isNull(maquetes3d.deletedAt), inArray(maquetes3d.status, [...x.status]),
      x.lido === null ? isNull(coluna) : eq(coluna, x.lido),
      delta > 0 && typeof p.limiteIA === "number" ? lt(maquetes3d.iaPranchasLidas, p.limiteIA) : undefined,
    ))
    .returning({ id: maquetes3d.id });
  if (r.length) x.lido = novo;
  return r.length > 0;
}

/** Quantas chamadas pagas esta execução ainda precisa: as pranchas para a IA ou, no fluxo antigo, os passos dele. */
export function pendentesIA(estado: EstadoLeitura): number {
  const espera = estado.passos.find(p => p.estado !== "feito");
  const antigo = !!espera && PASSOS_IA_ANTIGOS.includes(espera.tipo) && espera.motor !== "geometrico";
  return estado.passos.filter(p => p.estado !== "feito" && p.estado !== "executando" && (antigo ? PASSOS_IA_ANTIGOS.includes(p.tipo) : p.tipo === "prancha_ia")).length;
}

/**
 * Por que este passo não pode chamar a IA agora (ou null se pode). Nunca é erro: o passo fica "aguardando" e
 * retoma dele. Ordem: chave → teto por maquete → confirmação desta execução.
 */
export function bloqueioDaIA(estado: EstadoLeitura, config: ConfigMaquete, x: Execucao, credencial: CredencialIA | null, semChave: string, unidade = "prancha(s)"):
  { aguardando: "chave" | "teto" | "confirmacao"; erro: string; modeloAConfirmar: string | null } | null {
  if (!credencial) return { aguardando: "chave", erro: semChave, modeloAConfirmar: null };
  const pendentes = pendentesIA(estado), modelo = modeloDaLeitura(credencial, config), conf = estado.confirmacaoIA;
  const limite = config.limitePranchasIA;
  // QA S-11 achado 3: confirmação feita com outro modelo (ou sem o modelo gravado, das versões antigas) não vale.
  // Sem o modelo gravado (QA S-11 r2, achado 4), pode até ser o mesmo: a mensagem não diz "com o modelo novo".
  const mudou = confirmacaoValida(conf) && conf!.modelo !== modelo;
  const avisoModelo = !mudou ? "" : conf!.modelo
    ? `O modelo mudou de ${conf!.modelo} para ${modelo} desde a confirmação: ela não vale para o modelo novo. `
    : `A confirmação anterior foi feita antes de o sistema registrar o modelo, e não dá para saber se era ${modelo}: por segurança, ela não vale. `;
  if (x.iaLidas >= limite && !(confirmacaoDoModelo(conf, modelo) && conf?.alemDoTeto)) {
    return {
      aguardando: "teto", modeloAConfirmar: modelo,
      erro: `${avisoModelo}Esta maquete já usou ${x.iaLidas} de ${limite} prancha(s) pela IA (teto por maquete, em Configurações). Para ler mais ${pendentes} ${unidade} pela IA (paga, modelo ${modelo}), um administrador precisa autorizar além do teto; ou siga sem a IA.`,
    };
  }
  if (!confirmacaoDoModelo(conf, modelo)) {
    const usada = !!conf && (conf.usadas ?? 0) >= conf.pranchas;
    return {
      aguardando: "confirmacao", modeloAConfirmar: modelo,
      erro: `${avisoModelo}${pendentes} ${unidade} precisam da leitura por IA (paga, modelo ${modelo}). ${mudou ? (conf!.modelo ? "Um administrador confirma de novo, com o modelo novo." : "Um administrador confirma de novo.") : usada ? `A confirmação anterior (${conf!.pranchas} prancha(s)) já foi usada: um administrador confirma de novo.` : "Um administrador confirma para esta leitura."}`,
    };
  }
  return null;
}

/** Com menos que isto do orçamento do passo, a IA não é chamada: o pedido devolve o controle (QA rodada 2, N7). */
export const MIN_TEMPO_IA_MS = 10_000;
/** Depois de tantas devoluções seguidas por falta de tempo, o passo vira erro (para a tela não ficar em laço). */
export const MAX_ADIAMENTOS = 3;

/** Tempo que sobra para a resposta da IA neste pedido (orçamento do passo menos o já gasto e a folga da gravação). */
export const prazoDaIA = (x: Execucao) => LIMITE_PASSO_MS - (Date.now() - x.inicio) - 2_000;

/**
 * QA rodada 2, N7: se baixar e preparar o PDF já gastou o orçamento e sobram menos de ~10 s, a IA não é chamada nem
 * reservada (não conta como usada): o passo continua pendente e a tela chama de novo. Repetido além do limite, erro
 * claro (nada foi cobrado).
 */
export function semTempoParaIA(x: Execucao, passo: PassoLeitura): boolean {
  if (LIMITE_PASSO_MS - (Date.now() - x.inicio) >= MIN_TEMPO_IA_MS) { passo.adiado = 0; return false; }
  passo.adiado = (passo.adiado ?? 0) + 1;
  // Pendente (e não erro): a tela continua o laço e chama de novo, sem a pessoa clicar.
  Object.assign(passo, { estado: "pendente", erro: null, aguardando: null });
  if (passo.adiado > MAX_ADIAMENTOS) {
    passo.adiado = 0;
    throw new LeituraIndisponivel("Preparar esta prancha para a IA levou tempo demais, várias vezes seguidas, e a IA não foi chamada (nada foi cobrado). Tente de novo este passo; se repetir, envie só as pranchas das plantas baixas.");
  }
  return true;
}

/**
 * Reserva a chamada paga deste passo: "executando", uma prancha a mais usada da confirmação e +1 no contador da
 * maquete, tudo num UPDATE condicional. Perdeu a corrida (outra aba reservou, a leitura mudou, o teto foi atingido
 * por outra execução): `ExecucaoConcorrente`, e a IA não é chamada.
 */
export async function reservarChamada(x: Execucao, estado: EstadoLeitura, passo: PassoLeitura, config: ConfigMaquete): Promise<void> {
  const conf = estado.confirmacaoIA!;
  const em = agora().toISOString();
  Object.assign(passo, { estado: "executando", reservadoEm: em, erro: null, aguardando: null });
  conf.usadas = (conf.usadas ?? 0) + 1;
  const ok = await gravarSeIgual(x, x.serializar(estado), { deltaIA: 1, limiteIA: conf.alemDoTeto ? null : config.limitePranchasIA });
  if (!ok) throw new ExecucaoConcorrente("Este passo já está sendo lido em outra aba ou janela.");
  x.iaLidas++;
  x.reserva = { chave: passo.chave, em, tokensEntrada: estado.tokensEntrada, tokensSaida: estado.tokensSaida };
}

/**
 * Erros em que a API certamente não cobrou (a API respondeu recusando: chave, permissão, limite de uso, sobrecarga,
 * fora do ar): a prancha volta para a confirmação e para o contador. O tipo vem das classes do SDK e do `status`
 * (`tipoDoErroIA`), nunca de `e.name` (QA rodada 2, N2). Tempo esgotado, conexão caída (a resposta pode ter sido
 * gerada e cobrada antes de a conexão cair) e resposta recebida contam como cobradas: o lado seguro do teto.
 */
export function naoCobrado(e: unknown): boolean {
  const tipo = tipoDoErroIA(e);
  return tipo === "limite" || tipo === "chave" || tipo === "permissao" || tipo === "sobrecarga" || tipo === "fora_do_ar";
}

/**
 * EPIC-027 C1 — erro ao CRIAR o lote: se a API respondeu com erro (inclusive pedido recusado, 4xx), o lote não foi
 * criado e nada foi cobrado. Tempo esgotado ou conexão caída: o lote pode ter sido criado (e vai ser lido e cobrado),
 * então conta como usado — o lado seguro do teto.
 */
export function naoCobradoNoEnvio(e: unknown): boolean {
  return naoCobrado(e) || tipoDoErroIA(e) === "recusado";
}

/** Devolve a reserva de uma chamada que não foi cobrada (a gravação final desconta do contador). */
export function devolverReserva(x: Execucao, estado: EstadoLeitura): void {
  if (estado.confirmacaoIA) estado.confirmacaoIA.usadas = Math.max(0, (estado.confirmacaoIA.usadas ?? 0) - 1);
  x.devolver++;
  x.iaLidas = Math.max(0, x.iaLidas - 1);
}

/** Tolerância para a diferença de relógio entre instâncias do servidor. */
export const TOLERANCIA_RELOGIO_MS = 5_000;

/**
 * Passo "executando": recente, é outra aba lendo (não faz nada); velho, foi interrompido e vira erro (a chamada conta
 * como usada). Data sem sentido ou à frente do relógio além da tolerância (instância com o relógio adiantado) também
 * é reserva vencida: o passo nunca fica preso até uma data do futuro (QA rodada 2, N3).
 */
export function reservaVencida(passo: PassoLeitura): boolean {
  // EPIC-027 C1: com o lote criado, a leitura corre na Anthropic (até 24 h) e cada "avançar" consulta; não vence pelo relógio.
  if (passo.lote?.id) return false;
  const em = passo.reservadoEm ? Date.parse(passo.reservadoEm) : NaN;
  const decorrido = agora().getTime() - em;
  return !Number.isFinite(em) || decorrido > LIMITE_RESERVA_MS || decorrido < -TOLERANCIA_RELOGIO_MS;
}
export const MENSAGEM_INTERROMPIDA = "A leitura deste passo pela IA foi interrompida antes de terminar. A chamada pode ter sido cobrada e conta como usada; tente de novo este passo.";
/** Passo com reserva ainda válida: a IA está lendo agora (nesta ou em outra aba). Reserva vencida não conta. */
export function passoEmCurso(estado: EstadoLeitura | null | undefined): PassoLeitura | undefined {
  return estado?.passos.find(p => p.estado === "executando" && !reservaVencida(p));
}
export const MENSAGEM_PASSO_EM_CURSO = "Um passo está sendo lido pela IA agora; aguarde terminar (a leitura em segundo plano pode levar alguns minutos) ou cancele a leitura pela IA, e tente de novo.";

/**
 * QA rodada 2, N1: enquanto um passo está sendo lido pela IA (reserva válida), confirmar, seguir sem a IA, ler de
 * novo, descartar, aplicar ou começar outra importação jogaria fora a resposta já paga. Essas rotas recusam
 * (CONFLICT na API) até o passo terminar.
 */
export function exigirSemPassoEmCurso(estado: EstadoLeitura | null | undefined): void {
  if (passoEmCurso(estado)) throw new LeituraIndisponivel(MENSAGEM_PASSO_EM_CURSO);
}

/**
 * Segunda barreira do N1: a gravação final do passo não bateu (a coluna mudou durante a chamada). Se no estado ATUAL
 * o mesmo passo continua "executando" com a MESMA reserva, aplica só o resultado dele (o próprio passo, o que ele
 * leu e os tokens) sobre o estado atual, em vez de jogar fora a resposta paga. Devolve false quando não é seguro
 * (reserva trocada, passo que reescreve a lista de passos, nada reservado).
 */
export function aplicarResultadoDoPasso(atual: EstadoLeitura, meu: EstadoLeitura, x: Execucao): boolean {
  const r = x.reserva;
  if (!r) return false;
  const alvo = atual.passos.find(p => p.chave === r.chave), feito = meu.passos.find(p => p.chave === r.chave);
  if (!alvo || !feito || alvo.estado !== "executando" || alvo.reservadoEm !== r.em) return false;
  // O inventário do fluxo antigo troca a lista inteira de passos: não dá para aplicar só ele.
  if (feito.tipo !== "prancha_ia" && !(PASSOS_IA_ANTIGOS.includes(feito.tipo) && feito.tipo !== "inventario")) return false;
  // Passo que continua em curso (lote enviado à IA, EPIC-027 C1) mantém a reserva; o que terminou a libera.
  Object.assign(alvo, { ...feito, reservadoEm: feito.estado === "executando" ? feito.reservadoEm : null });
  if (feito.estado === "feito") {
    const k = feito.tipo === "prancha_ia" ? `prancha:${feito.doc}:${feito.pagina}` : feito.chave;
    if (k in meu.parciais) atual.parciais[k] = meu.parciais[k];
  }
  atual.tokensEntrada += Math.max(0, meu.tokensEntrada - r.tokensEntrada);
  atual.tokensSaida += Math.max(0, meu.tokensSaida - r.tokensSaida);
  // Chamada não cobrada: devolve também a prancha da confirmação, se ela ainda for a mesma desta reserva.
  if (x.devolver && atual.confirmacaoIA && atual.confirmacaoIA.em === meu.confirmacaoIA?.em) {
    atual.confirmacaoIA.usadas = Math.max(0, (atual.confirmacaoIA.usadas ?? 0) - x.devolver);
  }
  return true;
}

/**
 * Grava o resultado do passo sobre o estado atual (segunda barreira do N1). `reler` devolve o estado gravado agora e
 * a execução dele (ou null se a leitura/importação não existe mais). Até 3 tentativas, sempre com gravação condicional.
 */
export async function gravarSobreOAtual(x: Execucao, meu: EstadoLeitura, reler: () => Promise<{ estado: EstadoLeitura; x: Execucao } | null>): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const atual = await reler();
    if (!atual || !aplicarResultadoDoPasso(atual.estado, meu, x)) return false;
    if (await gravarSeIgual(atual.x, atual.x.serializar(atual.estado), { deltaIA: -x.devolver })) return true;
  }
  return false;
}
export const MENSAGEM_EM_CURSO = "Este passo já está sendo lido pela IA em outra aba ou janela. Aguarde alguns segundos e continue.";
/** EPIC-027 C1: a prancha está no lote da Anthropic; a tela consulta de tempos em tempos (pode fechar a página). */
export const MENSAGEM_LOTE = "A prancha está sendo lida pela IA em segundo plano. Pode levar alguns minutos; você pode fechar esta página (a leitura continua e a tela retoma quando você voltar).";

/** Modelo que vale AGORA para a leitura por IA (o mesmo que bloqueioDaIA e a chamada usam): gravado na confirmação. */
export async function modeloParaConfirmar(config: ConfigMaquete): Promise<string> {
  return modeloDaLeitura(await dependencias().credencialIA().catch(() => null), config);
}

/** Unidade dos passos do motor "IA em tudo" nas mensagens de bloqueio. */
export const UNIDADE_MOTOR_IA = "passo(s) do motor \"IA em tudo\"";

/**
 * QA S-11 r2, achado 2: a confirmação só grava o modelo que a tela mostrou ao admin (`modeloVisto`). Se ele não veio
 * (tela de uma versão anterior) ou é outro que o modelo que vale agora, nada é confirmado: os passos parados passam a
 * mostrar o modelo de agora (o chamador grava o estado) e volta a mensagem para o admin conferir e confirmar de novo.
 */
export async function modeloDaConfirmacao(estado: EstadoLeitura, config: ConfigMaquete, x: Execucao, modeloVisto: string | undefined):
  Promise<{ modelo: string } | { erro: string }> {
  const credencial = await dependencias().credencialIA().catch(() => null);
  const modelo = modeloDaLeitura(credencial, config);
  const visto = modeloVisto?.trim() || null;
  if (visto === modelo) return { modelo };
  for (const p of estado.passos) {
    if (p.estado !== "aguardando" || (p.aguardando !== "confirmacao" && p.aguardando !== "teto")) continue;
    Object.assign(p, bloqueioDaIA(estado, config, x, credencial, p.erro ?? "", p.tipo === "prancha_ia" ? undefined : UNIDADE_MOTOR_IA) ?? { modeloAConfirmar: modelo });
  }
  return {
    erro: visto
      ? `O modelo mudou de ${visto} para ${modelo}; confira e confirme de novo. Nada foi confirmado.`
      : `Esta página não mostrou qual modelo da IA será usado (ela foi aberta antes de uma atualização do sistema). Recarregue a página, confira o modelo (${modelo}) e confirme de novo. Nada foi confirmado.`,
  };
}

/**
 * Confirmação do admin para ESTA execução: `pranchas` = as pendentes dentro do que sobra do teto (ou todas, com
 * `alemDoTeto`). Sem nada pendente ou com o teto já usado sem o "além do teto": erro claro, nada é autorizado.
 */
export function novaConfirmacao(estado: EstadoLeitura, config: ConfigMaquete, iaLidas: number, userId: number, alemDoTeto: boolean, modelo: string) {
  const pendentes = pendentesIA(estado);
  if (!pendentes) return { erro: "Não há prancha esperando a leitura pela IA nesta execução." } as const;
  const restante = Math.max(0, config.limitePranchasIA - iaLidas);
  if (!alemDoTeto && !restante) return { erro: `Esta maquete já usou o teto de ${config.limitePranchasIA} prancha(s) pela IA. Para passar dele, use "Autorizar além do teto"; ou siga sem a IA.` } as const;
  const pranchas = alemDoTeto ? pendentes : Math.min(pendentes, restante);
  // o modelo com que o custo foi confirmado (QA S-11 achado 3): se o que vale na hora de ler for outro, pede de novo
  estado.confirmacaoIA = { em: agora().toISOString(), por: userId, pranchas, usadas: 0, ...(alemDoTeto ? { alemDoTeto: true } : {}), modelo };
  for (const p of estado.passos) if (p.estado === "aguardando" && (p.aguardando === "confirmacao" || p.aguardando === "teto")) Object.assign(p, { estado: "pendente", aguardando: null, erro: null });
  return { pranchas } as const;
}

/** Seguir sem a IA: as pranchas pendentes ficam com o leitor próprio; as paradas no teto entram na lista do teto. */
export function pularPassosIA(estado: EstadoLeitura, config: ConfigMaquete): void {
  for (const p of estado.passos) {
    if (p.tipo !== "prancha_ia" || p.estado === "feito" || p.estado === "executando") continue;
    if (p.aguardando === "teto") {
      estado.foraDoLimiteIA = [...(estado.foraDoLimiteIA ?? []), `${p.rotulo.replace(/^Leitura pela IA — /, "")}: ${p.motivoIA ?? "precisava da IA"}. Passou do limite de ${config.limitePranchasIA} prancha(s) pela IA por maquete (Configurações) e ficou o que o leitor próprio leu.`];
    }
    Object.assign(p, { estado: "feito", motor: "pulada", aguardando: null, erro: null });
  }
}
