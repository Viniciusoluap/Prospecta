// EPIC-025 (Dolores, etapa 2) — o "laço de ferramentas": o comando do dono vai ao modelo da Anthropic com a lista
// fechada das ferramentas liberadas; cada chamada que o modelo pede é executada pela MESMA porta da ponte
// (`executarFuncao`: pausa, usuária, lista, validação, limite, READ ONLY, filtro de dados pessoais, auditoria) e o
// resultado volta ao modelo só como `tool_result`. Tetos: voltas, tokens por pedido, limite mensal e prazo total (a função
// da Vercel tem 60 s). Estourando, responde o que tem e diz que parou. Quem decide SE a IA pode rodar é whatsapp.ts.
import type { Limites } from "../../shared/dolores/whatsapp.js";
import { liberarReserva, registrarConsumo, reservarChamada, type UsoDaChamada } from "./consumo.js";
import { mascararDadosPessoais } from "./dados-pessoais.js";
import { PEDIDO_DE_FECHAMENTO, promptSistemaWhatsapp } from "./prompt.js";
import { executarFuncao, ferramentasLiberadas } from "./ponte.js";

/** Voltas ao modelo por pedido (cada volta pode pedir várias consultas). */
export const MAX_VOLTAS = 6;
/** Consultas executadas por volta; as demais voltam como erro ("não executada"). */
export const MAX_FERRAMENTAS_POR_VOLTA = 6;
/** Saída máxima de uma chamada (a resposta do WhatsApp é cortada em ~3.800 caracteres). */
export const MAX_TOKENS_SAIDA = 2000;
/** Entrada acumulada por pedido (o contexto cresce a cada volta); passou, fecha com o que tem. */
export const TETO_ENTRADA_POR_PEDIDO = 150_000;
/** Não começa uma chamada ao modelo com menos que isso de prazo. */
export const MINIMO_PARA_CHAMAR_MS = 8_000;
/** Folga guardada no fim para enviar a resposta e auditar. */
export const FOLGA_FINAL_MS = 3_000;
/** Prazo de uma consulta dentro do laço. */
const PRAZO_CONSULTA_MS = 15_000;
/** Reserva mínima de entrada por chamada (o contexto só cresce: a reserva é o maior entre isto e a entrada da última). */
export const RESERVA_MINIMA_ENTRADA = 4_000;
/** A reserva vence sozinha depois disto (a função da Vercel morre aos 60 s). */
const VALIDADE_RESERVA_MS = 90_000;

type BlocoTexto = { type: "text"; text: string };
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
    // o texto do sistema e as ferramentas se repetem em todas as voltas: cache reduz o custo
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

export type MotivoParada = "voltas" | "teto_tokens" | "tempo" | "limite_mensal" | "outro_pedido" | "max_tokens" | "erro_modelo" | "recusa";
const ROTULO_PARADA: Record<MotivoParada, string> = {
  voltas: "limite de consultas por pedido",
  teto_tokens: "limite de tamanho por pedido",
  tempo: "o tempo de resposta acabou",
  limite_mensal: "o limite mensal de gasto com a IA foi atingido",
  outro_pedido: "há outro pedido em andamento usando o que resta do limite do mês; tente de novo em um minuto",
  max_tokens: "a resposta ficou longa demais",
  erro_modelo: "a IA não respondeu",
  recusa: "a IA recusou o pedido",
};

export type ResultadoComando = {
  texto: string; parou: MotivoParada | null; voltas: number; consultas: string[];
  tokens: { entrada: number; saida: number };
};

export type PedidoComando = {
  comando: string; mensagemId: number; apiKey: string; modelo: string; limites: Limites; mes: string;
  /** Instante (ms) em que tudo — laço e envio — precisa ter terminado. */
  prazoFinal: number;
  /** Relógio do prazo (o mesmo do aviso inteiro); padrão Date.now. */
  relogio?: () => number;
};

const usoDe = (r: RespostaModelo): UsoDaChamada => ({
  entrada: Number(r.usage?.input_tokens ?? 0), saida: Number(r.usage?.output_tokens ?? 0),
  cacheEscrita: Number(r.usage?.cache_creation_input_tokens ?? 0), cacheLeitura: Number(r.usage?.cache_read_input_tokens ?? 0),
});
const textoDe = (blocos: Bloco[]) => blocos.filter((b): b is BlocoTexto => b.type === "text" && typeof (b as BlocoTexto).text === "string").map(b => b.text).join("\n").trim();

export async function executarComando(p: PedidoComando): Promise<ResultadoComando> {
  const chamar = clienteTeste ?? clientePadrao;
  const ferramentas = ferramentasLiberadas();
  // A mensagem do dono é a ÚNICA entrada de texto do usuário; tudo o que vem do sistema entra como tool_result.
  const mensagens: MensagemModelo[] = [{ role: "user", content: [{ type: "text", text: p.comando }] }];
  const tokens = { entrada: 0, saida: 0 };
  const consultas: string[] = [];
  let voltas = 0;
  let parou: MotivoParada | null = null;
  let ultimoTexto = "";
  let final: string | null = null;
  const relogio = p.relogio ?? Date.now;
  const restante = () => p.prazoFinal - relogio() - FOLGA_FINAL_MS;

  let ultimaEntrada = 0;
  /** Reserva o limite mensal sob trava antes da chamada; bloqueado → para com "limite_mensal". */
  const reservar = async (): Promise<boolean> => {
    try {
      const b = await reservarChamada({ mes: p.mes, mensagemId: p.mensagemId, limites: p.limites, validadeMs: VALIDADE_RESERVA_MS,
        reserva: { entrada: Math.max(RESERVA_MINIMA_ENTRADA, ultimaEntrada), saida: MAX_TOKENS_SAIDA } });
      if (b) { parou = b === "outro_pedido" ? "outro_pedido" : "limite_mensal"; return false; }
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
        apiKey: p.apiKey, modelo: p.modelo, sistema: promptSistemaWhatsapp(mascararDadosPessoais()), ferramentas, mensagens,
        maxTokens: MAX_TOKENS_SAIDA, timeoutMs: Math.max(1000, restante()), semFerramentas,
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
    mensagens.push({ role: "assistant", content: r.content });
    const texto = textoDe(r.content);
    if (texto) ultimoTexto = texto;
    if (r.stop_reason !== "tool_use") {
      if (r.stop_reason === "refusal") parou = "recusa";
      else if (r.stop_reason === "max_tokens") parou = "max_tokens";
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
        { canal: "whatsapp", prazoMs: Math.max(1000, Math.min(PRAZO_CONSULTA_MS, restante() - 1000)) },
      );
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
  let texto: string;
  if (!parou) texto = corpo || "Dolores: não tenho o que responder a esse pedido com os dados do sistema.";
  else {
    const consultou = consultas.length ? ` Consultei: ${Array.from(new Set(consultas)).join(", ")}.` : "";
    const aviso = `(Parei antes de terminar: ${ROTULO_PARADA[parou]}.${consultou} Nada foi alterado no sistema.)`;
    texto = corpo ? `${corpo}\n\n${aviso}` : `Dolores: não consegui concluir. ${aviso}`;
  }
  return { texto, parou, voltas, consultas, tokens };
}
