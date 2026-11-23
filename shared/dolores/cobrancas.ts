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
/** Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher), como AAAA-MM-DD. */
export function domingoDePascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
/** Feriados nacionais fixos (MM-DD). 20/11 (Consciência Negra) é nacional desde a Lei 14.759/2023. */
export const FERIADOS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"] as const;
/** Feriados móveis, em dias a partir do domingo de Páscoa: Carnaval (segunda e terça), Sexta-feira Santa e Corpus Christi. */
export const FERIADOS_MOVEIS_DESDE_A_PASCOA = { carnavalSegunda: -48, carnavalTerca: -47, sextaFeiraSanta: -2, corpusChristi: 60 } as const;
const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** O dia (AAAA-MM-DD, no calendário de Fortaleza) é feriado nacional fixo ou móvel? Feriado estadual/municipal não é conhecido. */
export function ehFeriadoNacional(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  if ((FERIADOS_FIXOS as readonly string[]).includes(dia.slice(5))) return true;
  const pascoa = domingoDePascoa(Number(dia.slice(0, 4)));
  return Object.values(FERIADOS_MOVEIS_DESDE_A_PASCOA).some(n => somarDias(pascoa, n) === dia);
}
/** Dia útil em Fortaleza: segunda a sexta e não é feriado nacional. */
const diaUtil = (agora: Date) => { const d = diaDaSemana(agora); return d >= 1 && d <= 5 && !ehFeriadoNacional(relogioBrasilia(agora).dia); };

/** Dentro do horário comercial (segunda a sexta, 08h–18h de Fortaleza, fora dos feriados nacionais)? */
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

/** Unidade de medida logo depois do número: aí não é dinheiro (área, distância, andamento). */
const NAO_E_DINHEIRO = String.raw`(?!\s?(?:%|m²|m2\b|m\b|metros?\b|km\b|ha\b|hectares?\b|cm\b|mm\b|kg\b|t\b|un\b|unidades?\b|lotes?\b|vagas?\b|andares?\b|dias?\b|meses\b|anos?\b))`;
const ESCALA = String.raw`(?:mil|milh(?:ão|ões|ao|oes)|bilh(?:ão|ões|ao|oes)|bi|k)`;
const MOEDA = String.raw`(?:R|US|U)\s?\$|\bBRL\b`;
const PADROES_DE_VALOR: ReadonlyArray<[RegExp, string]> = [
  // R$ / US$ / U$ / BRL antes do número: "R$ 1.500,00", "US$10", "BRL 3.000", "R$ 2 mil"
  [new RegExp(String.raw`(?:${MOEDA})\s?-?\s?\d(?:[\d.]|\s(?=\d))*(?:,\d+)?(?:\s?${ESCALA}\b)?`, "gi"), "[valor omitido]"],
  // moeda depois do número: "2.000 R$", "3.000,00 BRL", "5 mil R$"
  [new RegExp(String.raw`\b\d[\d.]*(?:,\d+)?(?:\s?${ESCALA})?\s?(?:${MOEDA})`, "gi"), "[valor omitido]"],
  // "1.500 reais", "5 mil reais", "2 milhões de reais", "200 contos"
  [new RegExp(String.raw`\b\d[\d.]*(?:,\d+)?\s?(?:${ESCALA}\s+(?:de\s+)?)?(?:reais|real|contos)\b`, "gi"), "[valor omitido]"],
  // escala sem moeda: "5 mil", "1,2 milhão", "30k" (não quando segue unidade: "2 mil m²")
  [new RegExp(String.raw`\b\d[\d.]*(?:,\d+)?\s?${ESCALA}\b${NAO_E_DINHEIRO}`, "gi"), "[valor omitido]"],
  // número com vírgula e 2 casas: "1.500,00", "1500,00" (não "12,50 m²")
  [new RegExp(String.raw`\b(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\b${NAO_E_DINHEIRO}`, "g"), "[valor omitido]"],
  // porcentagem ligada a dinheiro: "comissão de 5%", "juros de 2%", "20% do valor", "10% de entrada", "1% ao mês"
  [/\b(comiss(?:ão|ao|oes|ões)|desconto|juros|entrada|sinal|taxa|multa|corre[çc][ãa]o)(\s+(?:de\s+)?)\d+(?:[.,]\d+)?\s?%/gi, "$1$2[valor omitido]"],
  [/\b\d+(?:[.,]\d+)?\s?%\s?(?=(?:do valor|do preço|do preco|de entrada|de sinal|de comiss|de desconto|de juros|de multa|a\.\s?m\.|a\.\s?a\.|ao m[eê]s|ao ano)\b)/gi, "[valor omitido] "],
];

/**
 * Tira valores em dinheiro do texto (título de tarefa, nome de serviço, nome de documento). Regra do dono: a cobrança nunca leva
 * valores. Cobre: moeda antes ou depois do número (R$, US$, U$, BRL), "reais"/"contos", escala sem moeda ("5 mil", "1,2 milhão",
 * "30k"), número com vírgula e duas casas ("1.500,00", "1500,00") e porcentagem ligada a dinheiro (comissão, desconto, juros,
 * entrada, sinal, taxa, multa, correção; "do valor", "ao mês"...).
 * NÃO tira (de propósito): porcentagem de andamento ("obra 80% concluída", "60% da documentação"), medidas ("12,50 m²",
 * "2 mil m²"), número sem vírgula nem moeda ("1.500" pode ser protocolo, lote ou matrícula) e datas.
 */
export function semValores(s: string): string {
  let t = s;
  for (const [re, troca] of PADROES_DE_VALOR) t = t.replace(re, troca);
  return t.replace(/\s+/g, " ").trim();
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
  /** Itens cujo responsável bate com mais de um usuário: só a fonte e o nome gravado (nunca o cliente). */
  ambiguos?: ReadonlyArray<{ fonte: FonteItem; responsavel: string }>;
}): string | null {
  const ambiguos = p.ambiguos ?? [];
  if (!p.cobrancas.length && !p.pedidos.length && !ambiguos.length) return null;
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
  if (ambiguos.length) partes.push(`- Itens com responsável ambíguo (o nome bate com mais de um usuário; ninguém foi cobrado — confira o responsável): ${ambiguos.length} — ${lista(ambiguos.map(a => `${ROTULO_FONTE[a.fonte]} (${nome(a.responsavel)})`))}.`);
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
