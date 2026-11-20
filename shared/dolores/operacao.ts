// EPIC-025 (Dolores, etapa 6) — regras puras da operação contínua: janelas das rondas e relatórios (idempotência), hora do
// relatório no horário de Brasília/Imperatriz (UTC−3 fixo, sem horário de verão; o Neon e a Vercel estão em GMT), o comando
// "relatório" do dono (reconhecido por CÓDIGO, nunca pelo modelo), a estimativa em reais (só com o preço informado pelo admin;
// o sistema não inventa preço) e o texto do relatório (MODELO FIXO, sem IA). Sem banco nem rede.
import { MAX_CARACTERES_WHATSAPP, cortarResposta } from "./whatsapp.js";
import { custoDoMes, linhaDoCustoParaRelatorio, type FuncaoDoConsumo, type PrecoModelo, type UsoDetalhado } from "./custo.js";

/** Teto mensal do dono (prompt mestre, seção 8): R$ 1.621, tudo incluído. Só referência na tela; o limite da IA é em tokens. */
export const TETO_DONO_REAIS = 1621;
/** Item da fila que vence em até isto aparece como "vence logo" na ronda. */
export const HORAS_AVISO_FILA = 6;
/** Quantos itens de cada seção a ronda guarda (destaques) e o relatório mostra. */
export const MAX_DESTAQUES = 5;
/** Teto de eventos "prazo vencido" registrados por ronda (o resto só conta). */
export const MAX_EVENTOS_PRAZO_POR_RONDA = 100;

const TRES_HORAS = 3 * 60 * 60_000;

/** Dia civil, hora e minuto em Brasília/Imperatriz (UTC−3). */
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
 * Agendamento do cron da Dolores na Vercel (vercel.json: "/api/cron/dolores"). É DIÁRIO: roda uma vez, às 10:00 UTC. Um
 * teste confere que o vercel.json bate com esta constante.
 */
export const CRON_DOLORES_AGENDA = "0 10 * * *";
/** Hora UTC do cron, tirada da agenda acima. */
export const HORA_CRON_DOLORES_UTC = Number(CRON_DOLORES_AGENDA.split(" ")[1]);
/** A mesma hora em Brasília/Imperatriz (UTC−3): 07. */
export const HORA_CRON_DOLORES_BRASILIA = (HORA_CRON_DOLORES_UTC + 21) % 24;
/**
 * Hora mais tarde que o relatório diário aceita (achado 4 do QA de segurança): com o cron diário, ele só roda às
 * {@link HORA_CRON_DOLORES_BRASILIA}h de Brasília; uma hora depois disso faria o relatório nunca sair. Servidor e tela usam
 * esta constante.
 */
export const HORA_MAX_RELATORIO = HORA_CRON_DOLORES_BRASILIA;
/** Horas que a tela oferece (0 até {@link HORA_MAX_RELATORIO}). */
export const HORAS_DO_RELATORIO: readonly number[] = Array.from({ length: HORA_MAX_RELATORIO + 1 }, (_, h) => h);
/** Hora do relatório limitada ao que o cron diário alcança (0 a {@link HORA_MAX_RELATORIO}). */
export const horaDoRelatorio = (hora: number) => Math.min(HORA_MAX_RELATORIO, Math.max(0, Number.isFinite(hora) ? Math.trunc(hora) : HORA_MAX_RELATORIO));

/** Janela do reenvio, pela tela, do texto já gravado do relatório diário: uma por minuto (não monta outro relatório). */
export const janelaReenvio = (agora: Date) => {
  const r = relogioBrasilia(agora);
  return `reenvio:${r.dia}T${r.hhmm}`;
};
/** Teto diário de relatórios sob demanda (tela + WhatsApp). Passou disso: frase fixa, sem ronda nem relatório. */
export const MAX_RELATORIOS_SOB_DEMANDA_DIA = 20;
/** Prefixo das janelas sob demanda de um dia (para contar o teto diário). */
export const prefixoSobDemandaDoDia = (agora: Date) => `sob-demanda:${relogioBrasilia(agora).dia}T`;

/** O relatório diário já pode sair? (hora local ≥ hora configurada, limitada à hora do cron). */
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
  grupos?: { aClassificar: number; aConferir: number; prontosParaSalvar: number; comErro: number };
  notas?: { semConfirmacao: number; confirmadasSemConciliacao: number; correcao: number; naoLidas: number };
  banco?: { sincronizadas24h: number; aClassificar: number };
  feitos24h?: { cobrancas: number; documentos: number; tarefas: number; acompanhamentos: number };
  eventos?: { prazosNovos: number; documentosGrupo24h: number; notasLidas24h: number };
  consumo?: { mes: string; entrada: number; saida: number; limiteEntrada: number; limiteSaida: number;
    /** Etapa 8: o consumo do mês por modelo e função, com os 4 tipos de token (para a estimativa por modelo). */
    linhas?: Array<{ modelo: string; funcao: FuncaoDoConsumo; uso: UsoDetalhado }> };
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
    sec("Documentos dos grupos", [`${n(t.grupos.aClassificar)} a classificar, ${n(t.grupos.aConferir)} a conferir (confiança baixa), ${n(t.grupos.prontosParaSalvar)} classificado(s) aguardando salvar no card, ${n(t.grupos.comErro)} com erro.`]);
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
      sec("Gasto da IA no mês", [`${tokens}${cache ? ` A entrada inclui ${n(cache)} de cache, que custa bem menos.` : ""} ${linhaDoCustoParaRelatorio(c, TETO_DONO_REAIS)}`]);
    } else {
      const reais = estimarReais({ entrada: t.consumo.entrada, saida: t.consumo.saida }, p.precos);
      sec("Gasto da IA no mês", [tokens
        + (reais == null ? " Estimativa em reais: falta informar o preço por milhão de tokens na tela." : ` Estimativa (preço único, cache como entrada cheia): ${brl(reais)} (teto do dono ${brl(TETO_DONO_REAIS)}).`)]);
    }
  }
  const faltam = p.falhas.map(f => NOME_SECAO[f as SecaoRonda] ?? f);
  L.push("", "Sem dado no sistema: \"aguardando providência interna\" (não há registro próprio para isso).");
  if (faltam.length) L.push(`Não consegui ler agora: ${faltam.join(", ")}.`);
  return cortarResposta(L.join("\n"), max);
}
