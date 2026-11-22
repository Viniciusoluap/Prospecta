// EPIC-025 (Dolores, etapa 2) — o "laço de ferramentas": o comando do dono vai ao modelo da Anthropic com a lista
// fechada das ferramentas liberadas; cada chamada que o modelo pede é executada pela MESMA porta da ponte
// (`executarFuncao`: pausa, usuária, lista, validação, limite, READ ONLY, filtro de dados pessoais, auditoria) e o
// resultado volta ao modelo só como `tool_result`. Tetos: voltas, tokens por pedido, limite mensal e prazo total (a função
// da Vercel tem 60 s). Estourando, responde o que tem e diz que parou. Quem decide SE a IA pode rodar é whatsapp.ts.
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { MAX_PARTES_RESPOSTA, type Limites } from "../../shared/dolores/whatsapp.js";
import { liberarReserva, registrarConsumo, reservarChamada, type UsoDaChamada } from "./consumo.js";
import { mascararDadosPessoais } from "./dados-pessoais.js";
import { PEDIDO_DE_FECHAMENTO, PEDIDO_DE_RESUMO, promptSistemaWhatsapp } from "./prompt.js";
import { intencaoDeAcao, pareceColagem, trechoDoDono, type MotivoContaminacao } from "../../shared/dolores/fila.js";
import { intencaoDeMemoria } from "../../shared/dolores/memoria-longa.js";
import { FUNCOES_DAS_MESAS, intencaoDeMesa } from "../../shared/dolores/mesas.js";
import { lerConfirmacao } from "../../shared/dolores/confirmacao.js";
import { ACOES, acaoPorNome } from "./acoes/registro.js";
import { AVISO_DADOS, leituraPorNome } from "./funcoes.js";
import { executarFuncao, ferramentasDaConversa, ferramentasDoWhatsapp, ferramentasLiberadas } from "./ponte.js";
import { FUNCAO_REURB, comAvisoReurb } from "../../shared/dolores/reurb-conhecimento.js";
import { pedeDetalhe, rotulosDasConsultas } from "../../shared/dolores/voz.js";
import type { ReferenciaConversa } from "../../drizzle/schema-dolores-conversa.js";
import { HISTORICO_VAZIO, montarMensagens, referenciasDoResultado, referenciasDoTurno, tokensEstimadosDoHistorico, tokensEstimadosDoTexto, type Historico } from "./memoria.js";

const ACOES_NOMES = new Set(ACOES.map(a => a.nome));
/** Ações da criadora de mesas (a leitura listar_mesas fica sempre): só com o pedido de mesa do dono, por código. */
export const ACOES_DE_MESA: ReadonlySet<string> = new Set(FUNCOES_DAS_MESAS.filter(n => n !== "listar_mesas"));

/**
 * A resposta desta função traz texto de dados (terceiros/banco)? Leituras e ações marcam no registro; nome desconhecido
 * contamina (na dúvida, contamina).
 */
export function contaminaOComando(nome: string): boolean {
  return leituraPorNome(nome)?.contamina ?? acaoPorNome(nome)?.contamina ?? true;
}

/**
 * Voltas ao modelo por pedido (cada volta pode pedir várias consultas). QA E8 A4: o máximo de chamadas ao modelo por pedido é
 * MAX_VOLTAS + 1 — a única chamada a mais é a de fechamento (parou por voltas/teto) OU a de resumo (parou em max_tokens sem
 * texto), nunca as duas, ambas sem ferramentas; a de resumo também respeita TETO_ENTRADA_POR_PEDIDO.
 */
export const MAX_VOLTAS = 6;
/** Consultas executadas por volta; as demais voltam como erro ("não executada"). */
export const MAX_FERRAMENTAS_POR_VOLTA = 6;
/**
 * Saída máxima de uma chamada. Etapa 8: a resposta ao dono pode ir em até 3 mensagens de ~3.800 caracteres (~11.400
 * caracteres ≈ 3.500 tokens em português); 5.000 dá folga sem passar do que cabe no prazo (ver tokensDeSaidaNoPrazo).
 */
export const MAX_TOKENS_SAIDA = 5000;
/**
 * EPIC-027 C5 (E1): na conversa normal a resposta é curta (1 a 4 frases); 1.500 tokens de teto. Quando o dono pede lista
 * completa, relatório ou detalhe (`pedeDetalhe`, por código), vale o teto da etapa 8 (MAX_TOKENS_SAIDA).
 */
export const MAX_TOKENS_SAIDA_CONVERSA = 1500;
/** Piso da saída de uma chamada (abaixo disso não vale chamar: MINIMO_PARA_CHAMAR_MS já barra antes). */
export const MINIMO_TOKENS_SAIDA = 1000;
/**
 * Velocidade de escrita assumida, por baixo (tokens por segundo). A chamada não é em fluxo: se o prazo acabar no meio, perde-se
 * tudo. Por isso a saída de cada chamada é limitada ao que cabe no tempo que resta — passou disso, o modelo para em
 * "max_tokens" e o texto parcial é ENVIADO (nunca descartado).
 */
export const TOKENS_POR_SEGUNDO_ESTIMADO = 100;
/** Saída da próxima chamada: o que cabe no prazo restante (descontados 3 s de ida e volta), entre o piso e MAX_TOKENS_SAIDA. */
export const tokensDeSaidaNoPrazo = (restanteMs: number, teto = MAX_TOKENS_SAIDA) =>
  Math.max(MINIMO_TOKENS_SAIDA, Math.min(teto, Math.floor(((restanteMs - 3_000) / 1000) * TOKENS_POR_SEGUNDO_ESTIMADO)));
/** Entrada acumulada por pedido (o contexto cresce a cada volta); passou, fecha com o que tem. */
export const TETO_ENTRADA_POR_PEDIDO = 150_000;
/** Não começa uma chamada ao modelo com menos que isso de prazo. */
export const MINIMO_PARA_CHAMAR_MS = 8_000;
/** Folga guardada no fim para enviar a resposta e auditar. */
export const FOLGA_FINAL_MS = 3_000;
/** QA E8 A1: tempo a mais guardado por mensagem extra da resposta (ela pode ir em até MAX_PARTES_RESPOSTA mensagens). */
export const FOLGA_POR_PARTE_MS = 1_500;
/** Folga do laço: a do fim + uma por parte extra — o envio de todas as partes cabe no prazo do aviso. */
export const FOLGA_DO_LACO_MS = FOLGA_FINAL_MS + (MAX_PARTES_RESPOSTA - 1) * FOLGA_POR_PARTE_MS;
/** Prazo de uma consulta dentro do laço. */
const PRAZO_CONSULTA_MS = 15_000;
/**
 * Reserva mínima de entrada por chamada (o contexto só cresce: a reserva é o maior entre isto e a entrada da última). QA C5-E1 r4
 * (achado 3): cobre o prefixo FIXO de toda chamada — texto do sistema (~5,7 mil bytes) + ferramentas com as ações (~25 mil bytes)
 * ≈ 10,3 mil tokens pela estimativa por cima (memoria.ts#tokensEstimadosDoTexto) + ~500 da própria API para ferramentas. Antes era
 * 4.000, abaixo do prefixo real (~9 mil). O teste c5-e1-qa-r4 confere que o piso continua cobrindo o prefixo quando ele crescer.
 */
// EPIC-027 C5 (E2): as 4 ferramentas de grupo aumentaram o prefixo (~12,7 mil pela estimativa por cima): piso 12.000 → 14.000.
// EPIC-027 C5 (memória de longo prazo): +3 ferramentas (~2,8 mil caracteres ≈ 1 mil tokens pela estimativa): o prefixo foi a ~13,8 mil;
// piso 14.000 → 15.000 (mais rígido, com folga).
// EPIC-027 C5-COM (mesa comercial ligada à maquete): +3 leituras e +1 ação (~4,6 mil caracteres ≈ 1,4 mil tokens pela estimativa): o
// prefixo foi a ~14,7 mil (+500 da API = ~15,2 mil, acima do piso): 15.000 → 17.000 (mais rígido, com folga para as frentes em paralelo).
// EPIC-027 C5 (criadora de mesas): +listar_mesas e +4 ações de mesa (~1,8 mil tokens pela estimativa): sozinha, ~15,2 mil; piso 17.000.
// Integração 2 (C5-COM + C5-MESAS + C5-E4 juntas): prefixo medido no pior caso (todas as ferramentas com ações, inclusive as de mesa)
// = sistema 2.474 + ferramentas 14.527 = 17.001 (+500 da API = 17.501 > 17.000): piso 17.000 → 19.000 (folga ~1,5 mil). Sem pedido de
// mesa, as 4 ações de mesa ficam fora (≈ 15,4 mil + 500).
// Com a REURB (main #296, +1 leitura só do dono): pior caso 2.474 + 14.809 = 17.283 (+500 = 17.783): piso 19.000 mantido (folga ~1,2 mil).
export const RESERVA_MINIMA_ENTRADA = 19_000;
/** Tokens que a API acrescenta por conta própria quando há ferramentas (instrução de uso de ferramentas), por cima. */
export const SOBRECARGA_DE_FERRAMENTAS = 500;
/** A reserva vence sozinha depois disto (a função da Vercel morre aos 60 s). */
const VALIDADE_RESERVA_MS = 90_000;

type BlocoTexto = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
type BlocoFerramenta = { type: "tool_use"; id: string; name: string; input: unknown };
type Bloco = BlocoTexto | BlocoFerramenta | { type: string; [k: string]: unknown };
type ResultadoFerramenta = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type MensagemModelo = { role: "user" | "assistant"; content: Array<Bloco | ResultadoFerramenta> };

export type PedidoModelo = {
  apiKey: string; modelo: string; sistema: string; ferramentas: ReturnType<typeof ferramentasLiberadas>;
  mensagens: MensagemModelo[]; maxTokens: number; timeoutMs: number; semFerramentas: boolean;
};
export type RespostaModelo = {
  content: Bloco[]; stop_reason: string | null;
  usage?: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | null;
};
export type ClienteModelo = (p: PedidoModelo) => Promise<RespostaModelo>;

const clientePadrao: ClienteModelo = async p => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const cliente = new Anthropic({ apiKey: p.apiKey, maxRetries: 0, timeout: p.timeoutMs });
  const r = await cliente.messages.create({
    model: p.modelo,
    max_tokens: p.maxTokens,
    // o texto do sistema e as ferramentas se repetem em todas as voltas: cache reduz o custo. EPIC-027 C5 (E1): o histórico da
    // conversa leva o próprio ponto de cache (memoria.ts#montarMensagens): lido do cache nas voltas seguintes do MESMO pedido e no
    // pedido seguinte só se ele chegar dentro de ~5 min (prazo do cache) e a janela não tiver cortado o começo.
    system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral" } }],
    tools: p.ferramentas as never,
    tool_choice: p.semFerramentas ? { type: "none" } : { type: "auto" },
    messages: p.mensagens as never,
  }, { timeout: p.timeoutMs });
  return r as unknown as RespostaModelo;
};
let clienteTeste: ClienteModelo | null = null;
/** Só para testes: troca o cliente do modelo (sem argumento, volta ao SDK da Anthropic). */
export function definirClienteModelo(c?: ClienteModelo) { clienteTeste = c ?? null; }

export type MotivoParada = "voltas" | "teto_tokens" | "tempo" | "limite_mensal" | "limite_da_conversa" | "outro_pedido" | "max_tokens" | "erro_modelo" | "recusa";
const ROTULO_PARADA: Record<MotivoParada, string> = {
  voltas: "limite de consultas por pedido",
  teto_tokens: "limite de tamanho por pedido",
  tempo: "o tempo de resposta acabou",
  limite_mensal: "o limite mensal de gasto com a IA foi atingido",
  // EPIC-027 C5-E5: só a parte da conversa acabou (as outras funções seguem)
  limite_da_conversa: "a parte do mês da nossa conversa com a IA acabou; os grupos e os documentos continuam funcionando",
  outro_pedido: "há outro pedido em andamento usando o que resta do limite do mês; tente de novo em um minuto",
  max_tokens: "a resposta ficou longa demais",
  erro_modelo: "a IA não respondeu",
  recusa: "a IA recusou o pedido",
};

export type ResultadoComando = {
  texto: string; parou: MotivoParada | null; voltas: number; consultas: string[];
  /** Códigos dos itens da fila que este comando criou ou achou já aguardando (para o quadro; nunca vão ao modelo). */
  codigosNaFila: string[];
  /** O comando leu dados antes de alguma ação (as ações diretas depois disso foram para a fila). */
  contaminado: boolean;
  tokens: { entrada: number; saida: number };
  /** EPIC-027 C5 (E1): ids + nome curto das entidades que as consultas devolveram (por código), para a memória da conversa. */
  referencias: ReferenciaConversa[];
  /**
   * EPIC-027 C5 (E2): o que este pedido propôs pode ser confirmado com "pode"/"confirmo" — a mensagem do DONO pede ação (verbo
   * de ação ou um "sim" dele, por código) e não tem texto colado. Falso: o que ficou esperando só sai pela aprovação com o
   * código ou pela tela (como antes), e não substitui a proposta que já esperava a resposta dele.
   */
  podeConfirmar: boolean;
  /**
   * EPIC-027 C5-COM: textos montados pelo SISTEMA (link da maquete, rascunho ao cliente) que vão ao dono num quadro, intactos, quando a
   * resposta do modelo não os traz exatamente. Só de leituras da conversa do dono (funcoes.ts#soConversaDoDono).
   */
  anexos: string[];
};

export type PedidoComando = {
  comando: string; mensagemId: number; apiKey: string; modelo: string; limites: Limites; mes: string;
  /** Instante (ms) em que tudo — laço e envio — precisa ter terminado. */
  prazoFinal: number;
  /** Relógio do prazo (o mesmo do aviso inteiro); padrão Date.now. */
  relogio?: () => number;
  /**
   * EPIC-027 C5 (E1): a conversa recente do dono (memoria.ts#lerJanela). Entra antes do pedido, com a origem de cada item; com
   * histórico, o pedido nasce CONTAMINADO (o histórico traz dado lido antes: ação direta vai para a confirmação do dono).
   */
  historico?: Historico;
  /**
   * EPIC-027 C5 (memória de longo prazo): o bloco das lembranças ATIVAS (memoria-longa.ts#blocoParaConversaDoDono), só na conversa
   * direta do dono. Vai como DADO rotulado no começo da conversa, com ponto de cache próprio (estável entre pedidos), e conta na reserva.
   */
  memoriaLonga?: string | null;
  /** A mensagem do dono veio com anexo (a legenda não vale como pedido de memória). */
  comMidia?: boolean;
};

const usoDe = (r: RespostaModelo): UsoDaChamada => ({
  entrada: Number(r.usage?.input_tokens ?? 0), saida: Number(r.usage?.output_tokens ?? 0),
  cacheEscrita: Number(r.usage?.cache_creation_input_tokens ?? 0), cacheLeitura: Number(r.usage?.cache_read_input_tokens ?? 0),
});
/**
 * Etapa 8 (custo): no laço do WhatsApp, o aviso do filtro que se repete em TODAS as descrições de leitura (~120 tokens × 17)
 * vai UMA vez no texto do sistema (prompt.ts, "Como responder"); a ponte HTTP e docs/dolores/ferramentas-*.json continuam
 * com a descrição inteira. Nada muda na regra: o filtro roda igual em toda resposta.
 */
export function ferramentasParaOModelo<T extends { description: string }>(lista: readonly T[]): T[] {
  return lista.map(f => (f.description.endsWith(AVISO_DADOS) ? { ...f, description: f.description.slice(0, -AVISO_DADOS.length) } : f));
}

/**
 * Etapa 8 — texto parcial (a resposta parou em "max_tokens"): corta no fim da última linha COMPLETA (a linha do meio, cortada,
 * sai). Sem nenhuma quebra de linha, corta no fim da última frase; sem frase completa, fica o que veio.
 */
export function cortarNaUltimaLinhaCompleta(texto: string): string {
  const t = texto.replace(/\s+$/, "");
  const quebra = t.lastIndexOf("\n");
  if (quebra > 0) return t.slice(0, quebra).trimEnd();
  const frase = Math.max(t.lastIndexOf(". "), t.lastIndexOf("! "), t.lastIndexOf("? "));
  return frase > 0 ? t.slice(0, frase + 1) : t;
}
/** Aviso curto no fim da resposta cortada por tamanho (o dono pede o resto em partes; ver a story E8 sobre "continuar"). */
export const AVISO_RESPOSTA_CORTADA = "(continua — a resposta passou do tamanho; peça o restante em partes, ex.: \"a partir do item 20\" ou \"só a próxima semana\".)";

/** QA E8 A2 — frases fixas (código) sobre ações na resposta cortada ou interrompida. */
export const AVISO_FERRAMENTA_CORTADA = "A consulta/ação que eu ia fazer foi cortada e NÃO foi executada.";
export const NADA_ALTERADO = "Nada foi alterado no sistema.";
export const CONFIRA_O_QUADRO = "Confira no quadro do sistema (na primeira mensagem) o que foi registrado ou ficou na fila.";

const textoDe = (blocos: Bloco[]) => blocos.filter((b): b is BlocoTexto => b.type === "text" && typeof (b as BlocoTexto).text === "string").map(b => b.text).join("\n").trim();

export async function executarComando(p: PedidoComando): Promise<ResultadoComando> {
  const chamar = clienteTeste ?? clientePadrao;
  // Etapa 3: leituras + ações liberadas (lista fechada). O dono é quem comandou (mensagemId conferido em whatsapp.ts).
  // Reforço (portão de QA): as ferramentas de ação só são oferecidas quando a mensagem do dono tem intenção de ação,
  // reconhecida por código; sem ela, o laço é só de leitura (e a porta recusa ação mesmo que o modelo a peça).
  // EPIC-027 C5 (E2): um "sim"/"pode" do dono sem proposta esperando também é pedido de ação dele (resposta a uma pergunta da
  // conversa) — o modelo pode PROPOR; nada executa sem a resposta dele à proposta, reconhecida por código.
  // EPIC-027 C5 (memória de longo prazo): "lembra que…", "guarda isso", "esquece que…" no trecho do DONO também é pedido de ação dele
  const querMemoria = intencaoDeMemoria(trechoDoDono(p.comando));
  // EPIC-027 C5 (criadora de mesas): "cria uma mesa para…", "quero que você passe a…", "aprova a mesa 3" no trecho do DONO (por código)
  const tiposMesa = intencaoDeMesa(trechoDoDono(p.comando));
  const comAcoes = intencaoDeAcao(p.comando) || querMemoria || tiposMesa.length > 0 || lerConfirmacao(p.comando)?.tipo === "sim" || lerConfirmacao(p.comando)?.tipo === "confirmo";
  const podeConfirmar = comAcoes && !pareceColagem(p.comando);
  // as leituras só do dono (REURB, mesas, maquete por lote) vão também no laço só de leitura ("quais mesas eu pedi?", "link do lote 4")
  // Integração 2 (EPIC-027 C5): as AÇÕES de mesa só são oferecidas quando a mensagem do dono pede mesa por código (o mesmo
  // `pedidoDeMesa` sem o qual a porta as recusa): sem perda nenhuma, ~1,5 mil tokens a menos no prefixo das outras mensagens.
  const abreMesa = tiposMesa.length > 0 && !pareceColagem(p.comando) && !p.comMidia;
  const ferramentas = ferramentasParaOModelo(comAcoes ? ferramentasDoWhatsapp().filter(f => abreMesa || !ACOES_DE_MESA.has(f.name)) : ferramentasDaConversa());
  // Barreira principal — CONTAMINAÇÃO, determinística: assim que o resultado de uma função que traz texto de dados entra
  // no laço, nenhuma ação direta roda no resto do comando (vai para a fila de aprovação do dono).
  // QA R2 N1: mensagem com cara de texto colado/citado (e-mail, conversa) nasce CONTAMINADA — o pedido pode não ser do
  // dono, e sim do texto colado: toda ação vai para a fila, marcada.
  let contaminado = pareceColagem(p.comando);
  let motivoContaminacao: MotivoContaminacao | null = contaminado ? "colagem" : null;
  // EPIC-027 C5 (E1): o histórico traz respostas e avisos montados com dado do sistema (e conteúdo encaminhado) — é leitura
  // anterior: o pedido nasce contaminado, como depois de uma consulta.
  const historico = p.historico ?? HISTORICO_VAZIO;
  // QA C5-E1 (achado 2): as referências também trazem nome de terceiro (cliente, grupo) ao modelo — contaminam do mesmo jeito.
  if (!contaminado && (historico.itens.some(i => i.papel !== "dono" || i.origem !== "mensagem") || historico.referencias.length > 0)) { contaminado = true; motivoContaminacao = "leitura"; }
  const refsPorConsulta: ReferenciaConversa[][] = [];
  const tetoDeSaida = pedeDetalhe(p.comando) ? MAX_TOKENS_SAIDA : MAX_TOKENS_SAIDA_CONVERSA;
  const codigosNaFila = new Set<string>();
  // A mensagem do dono é a ÚNICA entrada de texto do usuário; tudo o que vem do sistema entra como tool_result.
  // QA r7 A8: antes de ir à Anthropic, o comando passa só pelo filtro de SEGREDOS e dados bancários (senha, token, código,
  // chave de API, agência/conta/PIX). CPF, telefone e e-mail que o dono digita de propósito para a busca ficam.
  const comando = sanitizarTexto(p.comando, { mascararDadosPessoais: false });
  // EPIC-027 C5 (E1): o histórico (rotulado por origem) vem antes; sem histórico, é a mesma mensagem única de antes.
  const mensagens: MensagemModelo[] = montarMensagens(historico, comando) as MensagemModelo[];
  // EPIC-027 C5 (memória de longo prazo): as lembranças vão ANTES do histórico, como DADO rotulado (nunca no texto do sistema), com
  // ponto de cache próprio: o bloco só muda quando uma lembrança muda, então o prefixo ferramentas + sistema + memória é lido do cache.
  // Com os dois do histórico e o do sistema, são no máximo 4 pontos (o teto da API).
  // QA C5 (achado C1): a memória de longo prazo NÃO contamina o pedido por si só. Ela é conteúdo que o PRÓPRIO dono mandou guardar
  // (pedido dele por código + o "pode" dele no WhatsApp) ou que o administrador gravou na tela — não é texto de terceiro. Antes,
  // com qualquer lembrança ativa, TODA proposta ganhava o aviso de "pedido feito depois de ler dados" e o aviso perdia o sentido.
  // Continua igual: vai rotulada como DADO (CABECALHO_MEMORIA, nunca no texto do sistema), não oferece ferramenta de ação (isso só a
  // mensagem do dono abre, por código) e nada executa sem o "pode"/"confirmo" dele (`exigirConfirmacao`) — a proposta mostra o
  // resumo exato do que será feito. Leitura do sistema, documento, grupo, histórico e texto colado continuam contaminando.
  const memoriaLonga = p.memoriaLonga?.trim() ? p.memoriaLonga : null;
  if (memoriaLonga) {
    const bloco: BlocoTexto = { type: "text", text: memoriaLonga, cache_control: { type: "ephemeral" } };
    if (mensagens[0]?.role === "user") mensagens[0].content.unshift(bloco); else mensagens.unshift({ role: "user", content: [bloco] });
  }
  // Só a mensagem do DONO pedindo memória (por código), direta, sem colagem e sem anexo, abre as ações de memória (o texto dela serve
  // para conferir que o fato saiu das palavras dele).
  const pedidoDeMemoria = querMemoria && !pareceColagem(p.comando) && !p.comMidia ? { texto: comando } : null;
  // EPIC-027 C5-COM: o pedido do DONO (direto, sem colagem e sem anexo) para a leitura conferir o que ele ditou (nome/valor no rascunho)
  const pedidoDoDono = !pareceColagem(p.comando) && !p.comMidia ? comando : null;
  /** EPIC-027 C5-COM: textos do sistema para o dono (link da maquete, rascunho), na ordem em que vieram. */
  const paraODono: Array<{ texto: string; seFaltar: string }> = [];
  // o mesmo para as mesas: só a mensagem direta do dono (sem colagem, sem anexo) abre propor/revisar/aprovar/recusar_mesa
  const pedidoDeMesa = abreMesa ? { texto: comando, tipos: tiposMesa } : null;
  const tokens = { entrada: 0, saida: 0 };
  const consultas: string[] = [];
  /** EPIC-027 C5 (REURB): a análise deu caso analisável — o aviso fixo vai no fim da resposta, por código. */
  let analisouReurb = false;
  let voltas = 0;
  let parou: MotivoParada | null = null;
  let ultimoTexto = "";
  let final: string | null = null;
  const relogio = p.relogio ?? Date.now;
  const restante = () => p.prazoFinal - relogio() - FOLGA_DO_LACO_MS;
  /** QA E8 A2: a resposta cortada em max_tokens trazia um pedido de consulta/ação (cortado ou completo) que NÃO foi executado. */
  let ferramentaCortada = false;

  // EPIC-027 C5 (E1): a 1ª reserva já conta o prefixo fixo (piso), o comando e o histórico (estimativas por cima, pelos bytes —
  // QA C5-E1 r4, achado 3); depois, a entrada real da última chamada.
  let ultimaEntrada = 0;
  const reservaInicial = RESERVA_MINIMA_ENTRADA + tokensEstimadosDoTexto(comando) + tokensEstimadosDoHistorico(historico) + (memoriaLonga ? tokensEstimadosDoTexto(memoriaLonga) : 0);
  /** Saída da próxima chamada (fixada na reserva: a chamada nunca pede mais do que reservou). */
  let saidaDaChamada = tetoDeSaida;
  /** Reserva o limite mensal sob trava antes da chamada; bloqueado → para com "limite_mensal". */
  const reservar = async (): Promise<boolean> => {
    saidaDaChamada = tokensDeSaidaNoPrazo(restante(), tetoDeSaida);
    try {
      const b = await reservarChamada({ mes: p.mes, mensagemId: p.mensagemId, limites: p.limites, validadeMs: VALIDADE_RESERVA_MS,
        reserva: { entrada: Math.max(reservaInicial, ultimaEntrada), saida: saidaDaChamada } });
      if (b) { parou = b === "outro_pedido" ? "outro_pedido" : b === "orcamento_conversa" ? "limite_da_conversa" : "limite_mensal"; return false; }
      return true;
    } catch (e) {
      // sem conseguir reservar, não chama (falha fechada: o limite é a trava do gasto)
      console.error("[dolores/cerebro] falha ao reservar o limite mensal", e instanceof Error ? e.name : "erro");
      parou = "erro_modelo";
      return false;
    }
  };

  const umaChamada = async (semFerramentas: boolean): Promise<RespostaModelo | null> => {
    voltas++;
    try {
      const r = await chamar({
        apiKey: p.apiKey, modelo: p.modelo, sistema: promptSistemaWhatsapp(mascararDadosPessoais("whatsapp")), ferramentas, mensagens,
        maxTokens: saidaDaChamada, timeoutMs: Math.max(1000, restante()), semFerramentas,
      });
      const uso = usoDe(r);
      ultimaEntrada = uso.entrada + uso.cacheEscrita + uso.cacheLeitura;
      tokens.entrada += ultimaEntrada;
      tokens.saida += uso.saida;
      await registrarConsumo({ mes: p.mes, mensagemId: p.mensagemId, modelo: p.modelo, volta: voltas, uso, parada: r.stop_reason });
      return r;
    } catch (e) {
      console.error("[dolores/cerebro] falha na chamada ao modelo", (e as { status?: number })?.status ?? (e instanceof Error ? e.name : "erro"));
      parou = restante() <= 0 || (e instanceof Error && /timeout|timed out|abort/i.test(e.message)) ? "tempo" : "erro_modelo";
      return null;
    } finally {
      await liberarReserva(p.mensagemId);
    }
  };

  laco: while (true) {
    if (voltas >= MAX_VOLTAS) { parou = "voltas"; break; }
    if (restante() < MINIMO_PARA_CHAMAR_MS) { parou = "tempo"; break; }
    if (tokens.entrada >= TETO_ENTRADA_POR_PEDIDO) { parou = "teto_tokens"; break; }
    if (!(await reservar())) break;
    const r = await umaChamada(false);
    if (!r) break;
    const texto = textoDe(r.content);
    if (texto) ultimoTexto = texto;
    // Etapa 8 — parou por tamanho: o texto parcial NUNCA é descartado. Um pedido de consulta cortado no meio (tool_use
    // incompleto) não é executado. Sem texto nenhum, uma última chamada SEM ferramentas pede a resposta curta.
    if (r.stop_reason === "max_tokens") {
      parou = "max_tokens";
      ferramentaCortada = r.content.some(b => b.type === "tool_use");
      if (texto) { final = texto; break; }
      const pendenteMax = mensagens[mensagens.length - 1];
      // QA E8 A4: a chamada de resumo respeita o teto de entrada do pedido (estourado, não chama: fica a frase fixa abaixo)
      if (pendenteMax.role === "user" && tokens.entrada < TETO_ENTRADA_POR_PEDIDO && restante() >= MINIMO_PARA_CHAMAR_MS && (await reservar())) {
        pendenteMax.content.push({ type: "text", text: PEDIDO_DE_RESUMO });
        const r2 = await umaChamada(true);
        if (r2) { const t2 = textoDe(r2.content); if (t2) final = t2; if (r2.stop_reason !== "max_tokens" && t2) parou = null; }
      }
      break;
    }
    mensagens.push({ role: "assistant", content: r.content });
    if (r.stop_reason !== "tool_use") {
      if (r.stop_reason === "refusal") parou = "recusa";
      final = texto;
      break;
    }
    const pedidos = r.content.filter((b): b is BlocoFerramenta => b.type === "tool_use");
    const resultados: ResultadoFerramenta[] = [];
    for (let i = 0; i < pedidos.length; i++) {
      const u = pedidos[i];
      if (i >= MAX_FERRAMENTAS_POR_VOLTA || restante() < 2_000) {
        resultados.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: JSON.stringify({ ok: false, erro: "Consulta não executada: limite de consultas ou de tempo deste pedido." }) });
        continue;
      }
      consultas.push(String(u.name).slice(0, 80));
      // A MESMA porta da ponte: o nome e os argumentos vêm do modelo e são conferidos lá (lista fechada, zod).
      const resp = await executarFuncao(
        { funcao: u.name, argumentos: u.input && typeof u.input === "object" ? u.input : {}, pedidoId: `wa:${p.mensagemId}:${voltas}:${i}` },
        { canal: "whatsapp", mensagemId: p.mensagemId, prazoMs: Math.max(1000, Math.min(PRAZO_CONSULTA_MS, restante() - 1000)),
          contaminado, motivoContaminacao, semAcoes: !comAcoes, aoPorNaFila: cs => cs.forEach(c => codigosNaFila.add(c)),
          // EPIC-027 C5 (E2): no WhatsApp do dono, nada executa na hora — tudo espera o "pode"/"confirmo" dele
          exigirConfirmacao: true, confirmacaoNatural: podeConfirmar, pedidoDeMemoria, pedidoDoDono, pedidoDeMesa },
      );
      // EPIC-027 C5-COM: só das leituras da conversa do dono (texto montado pelo sistema, já pelo filtro da porta)
      if (resp.body.ok === true && leituraPorNome(String(u.name))?.soConversaDoDono) {
        const d = (resp.body.dados as { paraODono?: { texto?: unknown; seFaltar?: unknown } } | undefined)?.paraODono;
        if (d && typeof d.texto === "string" && typeof d.seFaltar === "string" && d.texto && d.seFaltar) paraODono.push({ texto: d.texto, seFaltar: d.seFaltar });
      }
      // a partir daqui (inclusive as próximas chamadas desta mesma volta), ação direta só pela fila
      // QA R2 N2: qualquer resposta — ok OU erro — com texto vindo do banco contamina (a porta marca); sem a marca, vale o
      // registro da função para respostas ok (na dúvida, contamina)
      const contamina = resp.contamina ?? (resp.body.ok === true && contaminaOComando(String(u.name)));
      if (contamina && !contaminado) { contaminado = true; motivoContaminacao = "leitura"; }
      // EPIC-027 C5 (E1): ids que a consulta devolveu do banco (por código) — para "ela", "esse grupo" no próximo pedido
      if (resp.body.ok === true) refsPorConsulta.push(referenciasDoResultado(resp.body));
      if (u.name === FUNCAO_REURB && resp.body.ok === true && (resp.body.dados as { analisavel?: unknown } | undefined)?.analisavel === true) analisouReurb = true;
      resultados.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(resp.body), ...(resp.body.ok === true ? {} : { is_error: true }) });
    }
    mensagens.push({ role: "user", content: resultados });
    continue laco;
  }

  // Parou com consultas feitas e ainda há tempo: uma última chamada SEM ferramentas para responder com o que já tem.
  const pendente = mensagens[mensagens.length - 1];
  if (final === null && (parou === "voltas" || parou === "teto_tokens") && pendente.role === "user" && restante() >= MINIMO_PARA_CHAMAR_MS) {
    if (await reservar()) {
      pendente.content.push({ type: "text", text: PEDIDO_DE_FECHAMENTO });
      const r = await umaChamada(true);
      if (r) { const t = textoDe(r.content); if (t) final = t; }
    }
  }

  const corpo = (final ?? ultimoTexto).trim();
  // QA E8 A2: o que vale sobre ações é o código — o quadro do sistema (na 1ª mensagem, whatsapp.ts) diz o que foi gravado ou ficou
  // na fila; sem ação executada neste pedido, o aviso diz que nada foi alterado. Um pedido de consulta/ação cortado nunca roda.
  const fezAcao = consultas.some(c => ACOES_NOMES.has(c));
  const sobreAcoes = `${ferramentaCortada ? ` ${AVISO_FERRAMENTA_CORTADA}` : ""} ${fezAcao ? CONFIRA_O_QUADRO : NADA_ALTERADO}`;
  let texto: string;
  if (!parou) {
    texto = corpo || "Dolores: não tenho o que responder a esse pedido com os dados do sistema.";
    // resumo depois de um corte com pedido de ferramenta: o texto veio sem a consulta/ação — o dono fica sabendo
    if (ferramentaCortada) texto = `${texto}\n\n(${sobreAcoes.trim()})`;
  } else if (parou === "max_tokens" && corpo) {
    // Etapa 8: o parcial vai ao dono (pelos mesmos filtros de saída, em whatsapp.ts), cortado na última linha completa
    texto = `${cortarNaUltimaLinhaCompleta(corpo)}\n\n${AVISO_RESPOSTA_CORTADA}${sobreAcoes}`;
  } else {
    // EPIC-027 C5 (E1): o que foi consultado em palavras de gente (nunca o nome interno da consulta)
    const consultou = consultas.length ? ` Já olhei: ${rotulosDasConsultas(consultas)}.` : "";
    const aviso = `(Parei antes de terminar: ${ROTULO_PARADA[parou]}.${consultou}${sobreAcoes})`;
    texto = corpo ? `${corpo}\n\n${aviso}` : `Dolores: não consegui concluir. ${aviso}`;
  }
  // EPIC-027 C5-COM: o que o modelo não repetiu exatamente vai intacto num quadro do sistema (sem repetir o mesmo texto)
  const anexos = Array.from(new Set(paraODono.filter(d => !texto.includes(d.seFaltar)).map(d => d.texto)));
  // EPIC-027 C5 (REURB): o aviso fixo no fim da resposta, por código, quando a análise deu caso analisável
  texto = comAvisoReurb(texto, analisouReurb);
  return { texto, parou, voltas, consultas, tokens, codigosNaFila: Array.from(codigosNaFila), contaminado, referencias: referenciasDoTurno(refsPorConsulta), podeConfirmar, anexos };
}
