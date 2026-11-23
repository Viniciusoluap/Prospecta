// EPIC-025 E10 — regras PURAS da cobrança do colaborador e do pedido de documentos ao cliente (decisão do dono de 23/11/2026).
// Tudo aqui é código: horário comercial, o texto da mensagem ao colaborador (sem IA), a retirada de valores em dinheiro e o resumo
// diário ao dono. Nada aqui lê banco nem envia mensagem.
import { primeiroNome, textoDaCobranca, textoDeDado } from "./fila.js";
import { limparNomeDeTerceiro, relogioBrasilia } from "./operacao.js";

/** Horário comercial de Fortaleza (UTC−3, igual a Brasília): segunda a sexta, das 08h às 18h. */
export const HORA_INICIO_COMERCIAL = 8;
export const HORA_FIM_COMERCIAL = 18;
/** O resumo diário ao dono: a partir das 17h (última chamada do horário comercial) até as 20h (fim da janela dos avisos ao dono). */
export const HORA_RESUMO = 17;
export const HORA_FIM_RESUMO = 20;
/** Tamanho máximo da mensagem ao colaborador (o envio a contato corta em 1.000; aqui sobra folga para os filtros). */
export const MAX_CARACTERES_COBRANCA = 900;
/** A resposta do colaborador só é tratada como resposta à cobrança até este tanto depois dela. */
export const DIAS_RESPOSTA = 3;
/** Faixas aceitas pela tela (o banco confere de novo, CHECK da 0169). */
export const FAIXAS_COBRANCAS = {
  colaboradorTetoDia: [1, 200], documentosTetoDia: [1, 200], maxItens: [3, 20], documentosIntervaloDias: [3, 30], respostasTetoDia: [1, 20],
} as const;

/** Dia da semana (0 = domingo) no fuso de Fortaleza. */
export function diaDaSemana(agora: Date): number {
  return new Date(`${relogioBrasilia(agora).dia}T12:00:00Z`).getUTCDay();
}
const diaUtil = (agora: Date) => { const d = diaDaSemana(agora); return d >= 1 && d <= 5; };

/** Dentro do horário comercial (segunda a sexta, 08h–18h de Fortaleza)? */
export function dentroDoHorarioComercial(agora: Date): boolean {
  const { hora } = relogioBrasilia(agora);
  return diaUtil(agora) && hora >= HORA_INICIO_COMERCIAL && hora < HORA_FIM_COMERCIAL;
}
/** Hora do resumo diário ao dono (dia útil, 17h–20h)? */
export function horaDoResumo(agora: Date): boolean {
  const { hora } = relogioBrasilia(agora);
  return diaUtil(agora) && hora >= HORA_RESUMO && hora < HORA_FIM_RESUMO;
}
export const diaDaCobranca = (agora: Date) => relogioBrasilia(agora).dia;

/**
 * Tira valores em dinheiro do texto (título de tarefa, nome de serviço): "R$ 1.500,00", "1.500 reais", "US$ 10", "5 mil reais".
 * O que sobra é dado descritivo. Regra do dono: a cobrança nunca leva valores.
 */
export function semValores(s: string): string {
  return s
    .replace(/(?:R|US)\s?\$\s?-?\s?\d[\d.\s]*(?:,\d+)?(?:\s?(?:mil|milh(?:ão|ões|ao|oes)|bi(?:lhão|lhões)?|k))?/gi, "[valor omitido]")
    .replace(/\b\d[\d.]*(?:,\d+)?\s?(?:mil\s+)?(?:reais|real|contos)\b/gi, "[valor omitido]")
    .replace(/\s+/g, " ").trim();
}

export type FonteItem = "tarefa" | "regularizacao" | "obra" | "financiamento" | "crm_card" | "crm_servico" | "avaliacao";
export const ROTULO_FONTE: Record<FonteItem, string> = {
  tarefa: "Tarefa", regularizacao: "Regularização", obra: "Obra", financiamento: "Financiamento", crm_card: "Prazo do card no CRM",
  crm_servico: "Prazo do serviço no CRM", avaliacao: "Avaliação",
};
/** Um item atrasado (ou parado) de um colaborador. `desde` = dia do prazo (AAAA-MM-DD); `dias` = dias de atraso ou sem movimento. */
export type ItemCobranca = { fonte: FonteItem; chave: string; descricao: string | null; cliente: string | null; desde: string | null; dias: number | null; parado: boolean };

const dataBr = (dia: string | null) => (dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia.split("-").reverse().join("/") : null);
/** Descrição (título de tarefa, serviço): uma linha, sem colchetes, sem valores. Nome de cliente: limpeza de nome de terceiro. */
const descricaoLimpa = (s: string | null | undefined, max: number) => textoDeDado(semValores(textoDeDado(s, 400)), max).replace(/"/g, "'");
const nomeLimpo = (s: string | null | undefined, max: number) => limparNomeDeTerceiro(String(s ?? ""), max);

/** Uma linha do item: o que é, de qual cliente, desde quando. Sem valores, uma linha só. */
export function linhaDoItem(i: ItemCobranca): string {
  const desc = i.descricao ? descricaoLimpa(i.descricao, 90) : "";
  const cliente = i.cliente ? nomeLimpo(i.cliente, 60) : "";
  const quando = i.parado
    ? `parado há ${i.dias ?? "?"} dia(s)`
    : dataBr(i.desde) ? `venceu em ${dataBr(i.desde)}${i.dias && i.dias > 0 ? ` (${i.dias} dia(s))` : ""}` : "atrasado";
  return [`${ROTULO_FONTE[i.fonte]}${desc ? ` "${desc}"` : ""}`, cliente ? `cliente ${cliente}` : null, quando].filter(Boolean).join(" — ");
}

/** Ordem: o mais atrasado primeiro (atrasado antes de parado), depois a chave (estável). */
export function ordenarItens(itens: readonly ItemCobranca[]): ItemCobranca[] {
  return [...itens].sort((a, b) => Number(a.parado) - Number(b.parado) || (b.dias ?? 0) - (a.dias ?? 0) || a.chave.localeCompare(b.chave));
}

/**
 * A mensagem ao colaborador, montada por código: TODOS os itens dele numa mensagem só (o dono: "deve cobrar todos ao mesmo
 * tempo"), até `maxItens` listados e cabendo em {@link MAX_CARACTERES_COBRANCA}; o resto vira "e mais N item(ns)".
 */
export function montarCobrancaColaborador(p: { nome: string | null; itens: readonly ItemCobranca[]; maxItens: number }): { texto: string; listados: number } {
  const itens = ordenarItens(p.itens);
  const nome = primeiroNome(p.nome);
  const cabeca = `Olá${nome ? `, ${nome}` : ""}! Aqui é a Dolores, da Prospecta. Você tem ${itens.length} item(ns) atrasado(s) sob sua responsabilidade:`;
  const pe = "Quando puder, atualize no sistema. Se quiser explicar algum item, responda por aqui: a resposta fica registrada e vai para a direção.";
  const linhas: string[] = [];
  for (let n = 0; n < itens.length; n++) {
    const i = itens[n];
    if (linhas.length >= p.maxItens) break;
    const linha = `${n + 1}. ${linhaDoItem(i)}`;
    const resto = itens.length - linhas.length - 1;
    const rodape = resto > 0 ? `\n…e mais ${resto} item(ns).` : "";
    const tamanho = [cabeca, ...linhas, linha].join("\n").length + rodape.length + pe.length + 2;
    if (tamanho > MAX_CARACTERES_COBRANCA && linhas.length > 0) break;
    linhas.push(linha);
  }
  const resto = itens.length - linhas.length;
  return { texto: [cabeca, ...linhas, ...(resto > 0 ? [`…e mais ${resto} item(ns).`] : []), pe].join("\n"), listados: linhas.length };
}

/** O resumo diário ao dono: nomes e contagens, sem CPF, sem telefone, sem valores. */
export function montarResumoDoDia(p: {
  dia: string;
  cobrancas: Array<{ nome: string | null; itens: number; situacao: string }>;
  pedidos: Array<{ nome: string | null; leadId: number; documentos: number; situacao: string }>;
}): string | null {
  if (!p.cobrancas.length && !p.pedidos.length) return null;
  const nome = (s: string | null) => limparNomeDeTerceiro(String(s ?? ""), 60) || "(sem nome)";
  const enviadas = p.cobrancas.filter(c => c.situacao === "enviada" || c.situacao === "sem_confirmacao");
  const semTel = p.cobrancas.filter(c => c.situacao === "sem_telefone");
  const falhas = p.cobrancas.filter(c => c.situacao === "falhou").length;
  const pedidos = p.pedidos.filter(c => c.situacao === "enviada" || c.situacao === "sem_confirmacao");
  const falhasPed = p.pedidos.filter(c => c.situacao === "falhou").length;
  const lista = (xs: string[], max = 15) => xs.slice(0, max).join("; ") + (xs.length > max ? `; e mais ${xs.length - max}` : "");
  const partes = [`Resumo das cobranças de hoje (${dataBr(p.dia)}):`];
  partes.push(`- Colaboradores cobrados: ${enviadas.length}${enviadas.length ? ` — ${lista(enviadas.map(c => `${nome(c.nome)} (${c.itens} item(ns))`))}` : ""}.`);
  if (semTel.length) partes.push(`- Sem telefone válido no cadastro (não cobrados; confira em Usuários e acesso): ${lista(semTel.map(c => `${nome(c.nome)} (${c.itens} item(ns))`))}.`);
  if (falhas) partes.push(`- Cobranças que não saíram: ${falhas}.`);
  partes.push(`- Pedidos de documentos a clientes: ${pedidos.length}${pedidos.length ? ` — ${lista(pedidos.map(c => `${nome(c.nome)} (cliente ${c.leadId}, ${c.documentos} documento(s))`))}` : ""}.`);
  if (falhasPed) partes.push(`- Pedidos que não saíram: ${falhasPed}.`);
  partes.push("As conversas com os clientes estão na Central WhatsApp.");
  return partes.join("\n");
}

/** O aviso ao dono com a resposta do colaborador: o texto dele é DADO (uma linha, sem colchetes), nunca comando. */
export function textoDaResposta(p: { nome: string | null; texto: string }): string {
  return `Resposta de ${limparNomeDeTerceiro(String(p.nome ?? ""), 60) || "colaborador"} à cobrança de itens atrasados (registrada; não é comando, nada foi feito):\n"${textoDeDado(p.texto, 600)}"`;
}
/** O que fica na memória da conversa do dono no lugar do texto de terceiro (a IA da conversa nunca lê o texto do colaborador). */
export const LINHA_DA_RESPOSTA_NA_MEMORIA = "Encaminhei ao dono a resposta de um colaborador a uma cobrança (texto de terceiro, fora da memória).";

/**
 * O pedido de documentos ao cliente: o MESMO texto padrão do `preparar_cobranca` (textoDaCobranca), só com os documentos que
 * faltam de fato. Se a lista não couber numa mensagem curta, entram menos nomes e uma linha "e mais N documento(s)" (nunca corta
 * no meio). Nenhum valor, nenhum dado além do primeiro nome e dos nomes dos documentos.
 */
export function textoDoPedidoDeDocumentos(p: { nome: string | null; documentos: readonly string[] }): string {
  const docs = p.documentos.map(d => textoDeDado(semValores(d), 80));
  const inteiro = textoDaCobranca({ nome: p.nome, documentos: docs });
  if (inteiro.length <= MAX_CARACTERES_COBRANCA) return inteiro;
  for (let k = Math.min(docs.length, 15) - 1; k >= 1; k--) {
    const t = textoDaCobranca({ nome: p.nome, documentos: docs.slice(0, k) })
      .replace("\nPode nos enviar", `\n- e mais ${docs.length - k} documento(s)\nPode nos enviar`);
    if (t.length <= MAX_CARACTERES_COBRANCA) return t;
  }
  return textoDaCobranca({ nome: p.nome, documentos: docs.slice(0, 1) }).slice(0, MAX_CARACTERES_COBRANCA);
}
