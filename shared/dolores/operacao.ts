// EPIC-025 (Dolores, etapa 6) — regras puras da operação contínua: janelas das rondas e relatórios (idempotência), hora do
// relatório no horário de Brasília/Imperatriz (UTC−3 fixo, sem horário de verão; o Neon e a Vercel estão em GMT), o comando
// "relatório" do dono (reconhecido por CÓDIGO, nunca pelo modelo), a estimativa em reais (só com o preço informado pelo admin;
// o sistema não inventa preço) e o texto do relatório (MODELO FIXO, sem IA). Sem banco nem rede.
import { MAX_CARACTERES_WHATSAPP, cortarResposta } from "./whatsapp.js";
import { custoDoMes, linhaDoCustoParaRelatorio, linhaDoGastoPorFuncao, situacaoDoGasto, type FuncaoDoConsumo, type PartesDoGasto, type PrecoModelo, type UsoDetalhado } from "./custo.js";

/** Teto mensal do dono (prompt mestre, seção 8): R$ 1.621, tudo incluído. Só referência na tela; o limite da IA é em tokens. */
export const TETO_DONO_REAIS = 1621;
/** Item da fila que vence em até isto aparece como "vence logo" na ronda. */
export const HORAS_AVISO_FILA = 6;
/** Quantos itens de cada seção a ronda guarda (destaques) e o relatório mostra. */
export const MAX_DESTAQUES = 5;
/** Teto de eventos "prazo vencido" registrados por ronda (o resto só conta). */
export const MAX_EVENTOS_PRAZO_POR_RONDA = 100;

const TRES_HORAS = 3 * 60 * 60_000;

/**
 * Dia civil, hora e minuto em Brasília/Imperatriz (UTC−3). Fuso FIXO: se o horário de verão voltar, esta conta e as 8
 * entradas do cron da Dolores (CRON_DOLORES_AGENDAS / vercel.json, hoje 10h a 17h UTC) têm de mudar JUNTAS.
 */
export function relogioBrasilia(d: Date): { dia: string; hora: number; minuto: number; hhmm: string } {
  const s = new Date(d.getTime() - TRES_HORAS).toISOString();
  return { dia: s.slice(0, 10), hora: Number(s.slice(11, 13)), minuto: Number(s.slice(14, 16)), hhmm: s.slice(11, 16) };
}

/** Janela da ronda/relatório: uma por dia no cron, uma por minuto sob demanda (clique duplo não duplica). */
export const janelaDiaria = (agora: Date) => `diaria:${relogioBrasilia(agora).dia}`;
export const janelaRelatorioDiario = (agora: Date) => `diario:${relogioBrasilia(agora).dia}`;
export const janelaSobDemanda = (agora: Date) => {
  const r = relogioBrasilia(agora);
  return `sob-demanda:${r.dia}T${r.hhmm}`;
};

/**
 * EPIC-026 C4 — horas que o dono pode escolher para o relatório diário (Brasília): 07:00 a 14:00. A ÚNICA lista: a tela, a
 * validação do servidor e o agendamento do cron saem daqui. O relatório continua saindo UMA vez por dia, na hora escolhida.
 */
export const HORA_MIN_RELATORIO = 7;
export const HORA_MAX_RELATORIO = 14;
/** Hora padrão (e a que vale para valor antigo/fora da lista gravado no banco). */
export const HORA_PADRAO_RELATORIO = 7;
export const HORAS_DO_RELATORIO: readonly number[] = Array.from({ length: HORA_MAX_RELATORIO - HORA_MIN_RELATORIO + 1 }, (_, i) => HORA_MIN_RELATORIO + i);
/** Hora do relatório válida (7 a 14). Valor antigo (0 a 6), fora da lista ou inválido → {@link HORA_PADRAO_RELATORIO}. */
export const horaDoRelatorio = (hora: number) => {
  const h = Number.isFinite(hora) ? Math.trunc(hora) : NaN;
  return HORAS_DO_RELATORIO.includes(h) ? h : HORA_PADRAO_RELATORIO;
};

const doisDigitos = (h: number) => String(h).padStart(2, "0");
/**
 * Agendamentos do cron da Dolores na Vercel (vercel.json). Uma entrada DIÁRIA por hora da lista (07h a 14h de Brasília =
 * 10h a 17h UTC; Brasília/Imperatriz é UTC−3 fixo): cada cron roda uma vez por dia, como o plano da Vercel exige. Caminhos
 * distintos (a primeira continua "/api/cron/dolores"; as outras levam a hora no fim) só para a Vercel não ver entradas
 * repetidas — o servidor IGNORA o fim do caminho: a hora vem do relógio. Um teste confere que o vercel.json bate com isto.
 */
export const CRON_DOLORES_AGENDAS: ReadonlyArray<{ path: string; schedule: string; horaBrasilia: number }> = HORAS_DO_RELATORIO.map(h => ({
  path: h === HORA_MIN_RELATORIO ? "/api/cron/dolores" : `/api/cron/dolores/${doisDigitos(h)}`,
  schedule: `0 ${(h + 3) % 24} * * *`,
  horaBrasilia: h,
}));
/** Caminhos que o servidor atende com a MESMA rotina (nenhum muda nada). */
export const CAMINHOS_CRON_DOLORES: readonly string[] = CRON_DOLORES_AGENDAS.map(a => a.path);
/** Primeira chamada do dia (a de "/api/cron/dolores"). */
export const CRON_DOLORES_AGENDA = CRON_DOLORES_AGENDAS[0].schedule;
/** Hora UTC da primeira chamada do dia: 10. */
export const HORA_CRON_DOLORES_UTC = Number(CRON_DOLORES_AGENDA.split(" ")[1]);
/** A mesma hora em Brasília/Imperatriz (UTC−3): 07. */
export const HORA_CRON_DOLORES_BRASILIA = (HORA_CRON_DOLORES_UTC + 21) % 24;
/** Hora UTC da última chamada do dia: 17. */
export const HORA_ULTIMO_CRON_DOLORES_UTC = Number(CRON_DOLORES_AGENDAS[CRON_DOLORES_AGENDAS.length - 1].schedule.split(" ")[1]);
/** Janela da ronda refeita na hora do relatório (dados frescos quando a hora escolhida é depois da ronda da manhã). */
export const janelaRondaDoRelatorio = (agora: Date) => `relatorio:${relogioBrasilia(agora).dia}`;

/** Janela do reenvio, pela tela, do texto já gravado do relatório diário: uma por minuto (não monta outro relatório). */
export const janelaReenvio = (agora: Date) => {
  const r = relogioBrasilia(agora);
  return `reenvio:${r.dia}T${r.hhmm}`;
};
/**
 * Janela da ÚNICA nova tentativa do dia feita pelo cron quando o envio do diário falhou (EPIC-026 C4): uma por dia, na mesma
 * tabela de janela única dos reenvios da tela. Um envio que na verdade saiu (tempo esgotado no provedor) chega no máximo duas vezes.
 */
export const janelaReenvioDoCron = (agora: Date) => `cron:${relogioBrasilia(agora).dia}`;
/** Teto diário de relatórios sob demanda (tela + WhatsApp). Passou disso: frase fixa, sem ronda nem relatório. */
export const MAX_RELATORIOS_SOB_DEMANDA_DIA = 20;
/** Prefixo das janelas sob demanda de um dia (para contar o teto diário). */
export const prefixoSobDemandaDoDia = (agora: Date) => `sob-demanda:${relogioBrasilia(agora).dia}T`;

/** O relatório diário já pode sair? (hora de Brasília ≥ hora configurada, de 7 a 14). */
export const relatorioDiarioNaHora = (agora: Date, hora: number) => relogioBrasilia(agora).hora >= horaDoRelatorio(hora);

const semAcento = (s: string) => s.normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").toLowerCase();
const COMANDO_RELATORIO = /^(dolores[,:]?\s+)?(manda(r)?\s+(o\s+)?)?relatorio(\s+(agora|do\s+dia|diario|de\s+hoje))?\s*[.!?]*$/;

/**
 * O dono pediu o relatório? A mensagem INTEIRA tem de ser o comando ("relatório", "relatório agora", "Dolores, relatório do
 * dia"…). Qualquer outra coisa segue o caminho normal (IA, se ligada). Não chama a IA nem gasta.
 */
export function ehComandoRelatorio(texto: string | null | undefined): boolean {
  if (typeof texto !== "string") return false;
  const t = semAcento(texto).replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= 40 && COMANDO_RELATORIO.test(t);
}

export type Precos = { entradaMilhao: number | null; saidaMilhao: number | null };
/**
 * R$ estimado de um uso em tokens com UM preço por milhão (entrada e saída). Sem os dois preços informados → null (não inventa).
 * Etapa 8: serve só para converter o LIMITE em reais e para rondas antigas (sem o detalhe por modelo); o gasto do mês usa
 * shared/dolores/custo.ts (por modelo e por tipo de token, com o cache pelo preço certo).
 */
export function estimarReais(uso: { entrada: number; saida: number }, p: Precos): number | null {
  if (p.entradaMilhao == null || p.saidaMilhao == null || !Number.isFinite(p.entradaMilhao) || !Number.isFinite(p.saidaMilhao)) return null;
  if (p.entradaMilhao < 0 || p.saidaMilhao < 0) return null;
  return Math.round(((uso.entrada / 1e6) * p.entradaMilhao + (uso.saida / 1e6) * p.saidaMilhao) * 100) / 100;
}

export type TotaisRonda = {
  carteira?: { clientesAtivos: number; servicosEmAndamento: number };
  fila?: { aguardando: number; venceLogo: number };
  atrasos?: { total: number; atrasados: number; parados: number; porModulo: Record<string, { atrasados: number; parados: number }> };
  tarefas?: { abertas: number; atrasadas: number; semPrazo: number };
  documentos?: { pendentes: number; clientes: number };
  recebiveis?: { cobrancas: number; emAberto: number; vencidas: number; vencido: number; regularizacoesComSaldo: number; saldoRegularizacoes: number };
  conversas?: { semLeitura: number };
  grupos?: { aClassificar: number; aConferir: number; prontosParaSalvar: number; comErro: number; aguardandoDono?: number; classificadosSemAviso?: number; obraExcluida?: number };
  notas?: { semConfirmacao: number; confirmadasSemConciliacao: number; correcao: number; naoLidas: number };
  banco?: { sincronizadas24h: number; aClassificar: number };
  feitos24h?: { cobrancas: number; documentos: number; tarefas: number; acompanhamentos: number };
  eventos?: { prazosNovos: number; documentosGrupo24h: number; notasLidas24h: number };
  consumo?: { mes: string; entrada: number; saida: number; limiteEntrada: number; limiteSaida: number;
    /** Etapa 8: o consumo do mês por modelo e função, com os 4 tipos de token (para a estimativa por modelo). */
    linhas?: Array<{ modelo: string; funcao: FuncaoDoConsumo; uso: UsoDetalhado }>;
    /** EPIC-027 C5-E5: a parte de cada função no limite (o relatório mostra o gasto por função contra a parte). */
    partes?: PartesDoGasto };
};
export type DestaquesRonda = {
  fila?: Array<{ codigo: string; funcao: string; venceEm: string }>;
  atrasos?: Array<{ modulo: string; cliente: string | null; diasDeAtraso: number | null; diasSemMovimentacao: number | null }>;
  tarefas?: Array<{ responsavel: string; atrasadas: number }>;
  documentos?: Array<{ cliente: string; quantidade: number }>;
};
export type SecaoRonda = keyof TotaisRonda;

/** Nomes das seções para o "não consegui ler". */
export const NOME_SECAO: Record<SecaoRonda, string> = {
  carteira: "clientes e serviços", fila: "fila de aprovação", atrasos: "atrasos", tarefas: "tarefas", documentos: "documentos pendentes",
  recebiveis: "recebimentos", conversas: "conversas", grupos: "documentos dos grupos", notas: "notas de obra", banco: "banco",
  feitos24h: "o que foi feito", eventos: "eventos", consumo: "gasto da IA",
};

const NOME_FUNCAO_FILA: Record<string, string> = {
  preparar_cobranca: "cobrança", gerar_documento: "documento", criar_card_cliente: "card de cliente", salvar_documentos_grupo: "documentos do grupo",
  conciliar_nota_obra: "conciliação de nota", salvar_nota_obra: "nota no Drive", criar_tarefa: "tarefa", registrar_acompanhamento: "acompanhamento",
};

const n = (x: number) => x.toLocaleString("pt-BR");
const brl = (x: number) => x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Teto de caracteres de um nome de terceiro (cliente, responsável, grupo) no relatório. */
export const MAX_NOME_TERCEIRO = 40;
// palavra de comando da fila e o que vem logo depois (o "código"): some tudo
const PALAVRA_DE_COMANDO = new RegExp("(^|[^\\p{L}])(aprovar|aprova|aprovo|recusar|recusa|recuso)(?=$|[^\\p{L}])(\\s+[^\\s]+)?", "giu");
const FORA_DO_NOME = new RegExp("[^\\p{L}\\p{M} .'’-]", "u");
/**
 * Nome vindo de cadastro de terceiro, limpo para o relatório (achado 1 do QA de segurança da etapa 6): espaços colapsados
 * (sem quebra de linha), corte no primeiro caractere que não seja letra, espaço, hífen, apóstrofo ou ponto (some negrito
 * `*`, `_`, `~`, crase, aspas, dígitos de código…), palavras de comando da fila ("aprovar", "recusar") retiradas junto com a palavra seguinte (o código) e no máximo
 * {@link MAX_NOME_TERCEIRO} caracteres. Nunca vira título de seção nem pedido de aprovação.
 */
export function limparNomeDeTerceiro(s: string | null | undefined, max = MAX_NOME_TERCEIRO): string {
  let t = String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  const corte = t.search(FORA_DO_NOME);
  if (corte >= 0) t = t.slice(0, corte);
  t = t.replace(/[*_~`"“”«»]/g, "").replace(PALAVRA_DE_COMANDO, "$1").replace(/\s+/g, " ").replace(/^[\s.'’-]+|[\s'’-]+$/g, "").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
/** Nome de terceiro como aparece no relatório: entre aspas angulares (é nome cadastrado, não texto da Dolores). */
const curto = (s: string | null | undefined) => {
  const t = limparNomeDeTerceiro(s);
  return t ? `«${t}»` : "(sem nome)";
};
/** "17/11 09:05" a partir de ISO. */
const diaHora = (iso: string) => {
  const r = relogioBrasilia(new Date(iso));
  return `${r.dia.slice(8, 10)}/${r.dia.slice(5, 7)} ${r.hhmm}`;
};

/**
 * Texto do relatório — MODELO FIXO, montado só com os números da ronda (nada vem de modelo de IA). Seção que a ronda não
 * conseguiu ler sai como "não consegui ler"; o que o sistema não registra sai como "sem dado no sistema". Cabe no WhatsApp.
 */
export function montarRelatorio(p: {
  tipo: "diario" | "sob_demanda"; geradoEm: Date; totais: TotaisRonda; destaques: DestaquesRonda; falhas: readonly string[]; precos: Precos;
  /** Etapa 8: preços por modelo (US$ por milhão) e cotação informados pelo admin; sem eles, só a reserva (`precos`). */
  precosPorModelo?: { tabela: ReadonlyMap<string, PrecoModelo>; cotacao: number | null };
}, max = MAX_CARACTERES_WHATSAPP): string {
  const t = p.totais, d = p.destaques;
  const r = relogioBrasilia(p.geradoEm);
  const L: string[] = [`Dolores — ${p.tipo === "diario" ? "relatório diário" : "relatório"} de ${r.dia.slice(8, 10)}/${r.dia.slice(5, 7)} às ${r.hhmm} (só dados do sistema)`];
  const sec = (titulo: string, corpo: string[]) => { if (corpo.length) L.push("", `*${titulo}*`, ...corpo); };

  if (t.fila) {
    const c = [`${n(t.fila.aguardando)} item(ns) na fila de aprovação${t.fila.venceLogo ? ` — ${n(t.fila.venceLogo)} vence(m) em até ${HORAS_AVISO_FILA} h` : ""}.`];
    for (const i of d.fila ?? []) c.push(`- ${i.codigo}: ${NOME_FUNCAO_FILA[i.funcao] ?? i.funcao} (vence ${diaHora(i.venceEm)})`);
    if (t.fila.aguardando) c.push("Responda \"aprovar CÓDIGO\" ou \"recusar CÓDIGO\".");
    sec("Decisões que dependem de você", c);
  }
  if (t.carteira) sec("Carteira", [`${n(t.carteira.clientesAtivos)} cliente(s) ativo(s) no CRM; ${n(t.carteira.servicosEmAndamento)} serviço(s) em andamento.`]);
  if (t.atrasos) {
    const mods = Object.entries(t.atrasos.porModulo).map(([m, v]) => `${m}: ${n(v.atrasados)} atrasado(s), ${n(v.parados)} parado(s)`);
    const c = [`${n(t.atrasos.total)} processo(s) atrasado(s) ou parado(s)${mods.length ? ` (${mods.join("; ")})` : ""}.`];
    for (const i of d.atrasos ?? []) {
      const quanto = i.diasDeAtraso != null ? `${i.diasDeAtraso} dia(s) de atraso` : i.diasSemMovimentacao != null ? `${i.diasSemMovimentacao} dia(s) sem movimentação` : "";
      c.push(`- ${i.modulo}: ${curto(i.cliente)}${quanto ? ` — ${quanto}` : ""}`);
    }
    if (t.eventos?.prazosNovos) c.push(`${n(t.eventos.prazosNovos)} prazo(s) venceram desde a ronda anterior.`);
    sec("Atrasados e parados", c);
  }
  if (t.tarefas) {
    const c = [`${n(t.tarefas.atrasadas)} tarefa(s) vencida(s) de ${n(t.tarefas.abertas)} aberta(s); ${n(t.tarefas.semPrazo)} sem prazo.`];
    for (const i of d.tarefas ?? []) if (i.atrasadas) c.push(`- ${curto(i.responsavel)}: ${n(i.atrasadas)} vencida(s)`);
    sec("Tarefas", c);
  }
  if (t.documentos) {
    const c = [`${n(t.documentos.pendentes)} documento(s) pendente(s) de ${n(t.documentos.clientes)} cliente(s).`];
    for (const i of d.documentos ?? []) c.push(`- ${curto(i.cliente)}: ${n(i.quantidade)}`);
    sec("Aguardando documentos", c);
  }
  if (t.recebiveis) {
    sec("Recebimentos pendentes", [
      `BPO: ${n(t.recebiveis.cobrancas)} cobrança(s) em aberto (${brl(t.recebiveis.emAberto)}), ${n(t.recebiveis.vencidas)} vencida(s) (${brl(t.recebiveis.vencido)}).`,
      `Regularizações com saldo a receber: ${n(t.recebiveis.regularizacoesComSaldo)} (${brl(t.recebiveis.saldoRegularizacoes)}).`,
    ]);
  }
  if (t.conversas) sec("Clientes sem retorno", [`${n(t.conversas.semLeitura)} conversa(s) de cliente com mensagem recebida ainda não lida.`]);
  if (t.grupos) {
    const linhas = [`${n(t.grupos.aClassificar)} a classificar, ${n(t.grupos.aConferir)} a conferir (confiança baixa), ${n(t.grupos.prontosParaSalvar)} classificado(s) aguardando salvar no card, ${n(t.grupos.comErro)} com erro.`];
    // Etapa 7: grupos novos que ela não soube identificar (só observam até o dono responder "grupo CÓDIGO tipo")
    // QA-SEG EPIC-027 (achado 1b): classificação pela tela sem o aviso (teto do dia)
    // QA-SEG EPIC-027 (R3-1): obra excluída no CRM — o grupo ficou calado até reclassificar
    if (t.grupos.obraExcluida) linhas.push(`${n(t.grupos.obraExcluida)} grupo(s) de engenharia com a obra excluída no CRM: ela ficou calada lá; reclassifique em Dolores › Grupos.`);
    if (t.grupos.classificadosSemAviso) linhas.push(`${n(t.grupos.classificadosSemAviso)} grupo(s) com o tipo mudado pela tela sem o aviso a você (teto de avisos do dia); confira em Dolores › Grupos.`);
    if (t.grupos.aguardandoDono) linhas.push(`${n(t.grupos.aguardandoDono)} grupo(s) novo(s) aguardando sua resposta (responda "grupo CÓDIGO tipo"; os códigos estão no aviso de entrada e em Dolores › Grupos).`);
    sec("Documentos dos grupos", linhas);
  }
  if (t.notas) {
    sec("Notas de obra", [`${n(t.notas.semConfirmacao)} sem confirmação do empreiteiro, ${n(t.notas.confirmadasSemConciliacao)} confirmada(s) sem conciliação com o banco, ${n(t.notas.correcao)} com pedido de correção, ${n(t.notas.naoLidas)} não lida(s)/ilegível(is).`]);
  }
  if (t.banco) sec("Banco", [`${n(t.banco.sincronizadas24h)} movimentação(ões) sincronizada(s) nas últimas 24 h; ${n(t.banco.aClassificar)} a classificar no BPO.`]);
  if (t.feitos24h) {
    sec("Feito nas últimas 24 h (pela Dolores)", [`Cobranças preparadas e aprovadas: ${n(t.feitos24h.cobrancas)}; documentos gerados: ${n(t.feitos24h.documentos)}; tarefas criadas: ${n(t.feitos24h.tarefas)}; acompanhamentos registrados: ${n(t.feitos24h.acompanhamentos)}.`]);
  }
  if (t.consumo) {
    const tokens = `Mês ${t.consumo.mes}: ${n(t.consumo.entrada)} tokens de entrada contados no limite (limite ${n(t.consumo.limiteEntrada)}) e ${n(t.consumo.saida)} de saída (limite ${n(t.consumo.limiteSaida)}).`;
    if (t.consumo.linhas) {
      // Etapa 8 — a MESMA conta da tela: por modelo e por tipo de token (cache pelo preço de cache), reserva só para modelo sem preço
      const c = custoDoMes(t.consumo.linhas, p.precosPorModelo?.tabela ?? new Map(), p.precos, p.precosPorModelo?.cotacao ?? null);
      const cache = c.porModelo.reduce((s, m) => s + m.uso.cacheEscrita + m.uso.cacheLeitura, 0);
      const corpo = [`${tokens}${cache ? ` A entrada bruta inclui ${n(cache)} de cache, que custa bem menos (no limite, o cache conta pelo peso do preço).` : ""} ${linhaDoCustoParaRelatorio(c, TETO_DONO_REAIS)}`];
      // EPIC-027 C5-E5 — o gasto de cada função contra a parte dela, em uma linha (a mesma conta da tela)
      if (t.consumo.partes) corpo.push(linhaDoGastoPorFuncao(situacaoDoGasto({ linhas: t.consumo.linhas, custo: c, partes: t.consumo.partes, tetoReais: TETO_DONO_REAIS,
        limites: { entrada: t.consumo.limiteEntrada, saida: t.consumo.limiteSaida } })));
      sec("Gasto da IA no mês", corpo);
    } else {
      const reais = estimarReais({ entrada: t.consumo.entrada, saida: t.consumo.saida }, p.precos);
      sec("Gasto da IA no mês", [tokens
        + (reais == null ? " Estimativa em reais: falta informar o preço por milhão de tokens na tela." : ` Estimativa (preço único, cache pelo peso do preço no limite): ${brl(reais)} (teto do dono ${brl(TETO_DONO_REAIS)}).`)]);
    }
  }
  const faltam = p.falhas.map(f => NOME_SECAO[f as SecaoRonda] ?? f);
  L.push("", "Sem dado no sistema: \"aguardando providência interna\" (não há registro próprio para isso).");
  if (faltam.length) L.push(`Não consegui ler agora: ${faltam.join(", ")}.`);
  return cortarResposta(L.join("\n"), max);
}
