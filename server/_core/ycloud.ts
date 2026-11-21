// EPIC-027 C7 (20/11/2026) — cliente HTTP mínimo da YCloud (API v2), com `fetch` puro (sem SDK).
// Conferido na documentação oficial em 20/11/2026:
// - base https://api.ycloud.com/v2, cabeçalho `X-API-Key` sem "Bearer": https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/authentication.md
// - erros { error: { status, code, message, requestId, whatsappApiError } } e catálogo de códigos: https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/handle-errors.md
// - GET /whatsapp/phoneNumbers (paginado: page 1-based, limit 1-100): https://docs.ycloud.com/api-reference/whatsapp-phone-numbers/list-phone-numbers.md
// - GET /whatsapp/templates (filter.wabaId, filter.status…): https://docs.ycloud.com/api-reference/whatsapp-templates/list-templates.md
// - POST /whatsapp/messages (fila; 200 = aceito; 400/404/422 não se repete): https://docs.ycloud.com/api-reference/whatsapp-messages/enqueue-a-message.md
// - POST /webhookEndpoints (devolve `secret`): https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/configure-webhooks.md
// - POST /unsubscribers: https://docs.ycloud.com/en/api-reference/guides/customer-data-and-operations/manage-unsubscribers.md
// Segurança: a URL base é FIXA (nenhuma URL vinda da tela é chamada); a chave só vai no cabeçalho; mensagens de erro saem montadas
// pelo código (status + código da YCloud), nunca com o texto da resposta, e passam por `semSegredo`.

export const URL_BASE_YCLOUD = "https://api.ycloud.com/v2";
const TEMPO_LIMITE_MS = 15_000;

export type FetchLike = typeof fetch;

export class ErroYcloud extends Error {
  constructor(message: string, readonly status: number | null, readonly codigo: string | null, readonly retryAfterS: number | null = null) {
    super(message);
    this.name = "ErroYcloud";
  }
  /** Tempo esgotado / rede caiu: o pedido pode ter chegado à YCloud (resultado ambíguo). */
  get ambiguo() { return this.status === null; }
}

/** Remove de um texto qualquer pedaço igual à chave/segredo (defesa extra: nada disso sai em erro ou log). */
export function semSegredo(texto: string, ...segredos: Array<string | null | undefined>): string {
  let t = texto;
  for (const s of segredos) if (s && s.length >= 6) t = t.split(s).join("…");
  return t;
}

const MENSAGEM_POR_CODIGO: Record<string, string> = {
  UNAUTHORIZED: "a YCloud recusou a chave (inválida ou revogada)",
  FORBIDDEN: "a chave não tem acesso a este recurso",
  ACCOUNT_LIMITED: "a conta tem restrição (ex.: conta de teste só envia a números verificados)",
  ACCOUNT_UNAVAILABLE: "a conta da YCloud está indisponível (fale com o suporte da YCloud)",
  BALANCE_INSUFFICIENT: "saldo insuficiente na YCloud (recarregue antes de enviar)",
  ACCOUNT_RATE_LIMITED: "limite de consultas da conta atingido",
  SENDER_RATE_LIMITED: "limite de envio do número atingido",
  TOO_MANY_REQUESTS: "muitas requisições seguidas",
  RECIPIENT_IN_BLOCK_LIST: "o destinatário está bloqueado",
  RECIPIENT_UNSUBSCRIBED: "o destinatário pediu para não receber",
  WHATSAPP_PHONE_NUMBER_UNAVAILABLE: "o número de envio está indisponível",
  WHATSAPP_TEMPLATE_UNAVAILABLE: "o modelo não existe ou não está aprovado",
  WHATSAPP_WABA_UNAVAILABLE: "a conta do WhatsApp (WABA) está indisponível",
  MESSAGING_REGION_UNSUPPORTED: "envio não suportado para essa região",
  PARAM_INVALID: "parâmetro inválido",
  PARAM_MISSING: "parâmetro obrigatório ausente",
  PARAM_INVALID_LENGTH: "parâmetro com tamanho fora do permitido",
  PARAM_NOT_MATCH: "parâmetros inconsistentes",
  BAD_REQUEST: "requisição inválida",
  NOT_FOUND: "recurso não encontrado",
  ALREADY_EXISTS: "já existe",
  CONTENT_PROHIBITED: "conteúdo proibido pelos termos",
  INTERNAL_SERVER_ERROR: "erro interno da YCloud",
  SERVICE_UNAVAILABLE: "YCloud temporariamente indisponível",
};

function codigoSeguro(v: unknown): string | null {
  return typeof v === "string" && /^[A-Z0-9_]{2,60}$/.test(v) ? v : null;
}

export type ChamadaYcloud = { apiKey: string; fetchImpl?: FetchLike };

async function chamar<T>(c: ChamadaYcloud, metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<T> {
  const f = c.fetchImpl ?? fetch;
  let resp: Response;
  try {
    resp = await f(`${URL_BASE_YCLOUD}${caminho}`, {
      method: metodo,
      headers: { "X-API-Key": c.apiKey, Accept: "application/json", ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch {
    throw new ErroYcloud("A YCloud não respondeu a tempo (rede ou tempo esgotado).", null, null);
  }
  let dados: any = null;
  try { dados = await resp.json(); } catch { dados = null; }
  if (resp.ok) return dados as T;
  const codigo = codigoSeguro(dados?.error?.code);
  const ra = Number(resp.headers.get("Retry-After"));
  const explicacao = (codigo && MENSAGEM_POR_CODIGO[codigo]) || "erro sem detalhe";
  throw new ErroYcloud(semSegredo(`A YCloud respondeu HTTP ${resp.status}${codigo ? ` (${codigo})` : ""}: ${explicacao}.`, c.apiKey), resp.status, codigo,
    Number.isFinite(ra) && ra >= 0 ? ra : null);
}

// ── Números ──

export type NumeroYcloud = {
  id?: string; phoneNumber?: string; displayPhoneNumber?: string; wabaId?: string; verifiedName?: string; status?: string;
  qualityRating?: string; messagingLimit?: string; whatsappBusinessManagerMessagingLimit?: string; throughputLevel?: string;
};
type Pagina<T> = { items?: T[]; offset?: number; limit?: number; length?: number; total?: number };

export async function listarNumerosYcloud(c: ChamadaYcloud): Promise<NumeroYcloud[]> {
  const r = await chamar<Pagina<NumeroYcloud>>(c, "GET", "/whatsapp/phoneNumbers?page=1&limit=100");
  return Array.isArray(r?.items) ? r.items : [];
}

// ── Modelos ──

export type ModeloYcloud = {
  wabaId?: string; name?: string; language?: string; category?: string; status?: string; reason?: string; qualityRating?: string;
  components?: Array<{ type?: string; format?: string; text?: string; buttons?: Array<{ type?: string; text?: string; url?: string }> }>;
  updateTime?: string;
};

/** Todos os modelos da WABA (até 5 páginas de 100). */
export async function listarModelosYcloud(c: ChamadaYcloud, wabaId: string | null): Promise<ModeloYcloud[]> {
  const out: ModeloYcloud[] = [];
  for (let page = 1; page <= 5; page++) {
    const q = new URLSearchParams({ page: String(page), limit: "100" });
    if (wabaId) q.set("filter.wabaId", wabaId);
    const r = await chamar<Pagina<ModeloYcloud>>(c, "GET", `/whatsapp/templates?${q.toString()}`);
    const itens = Array.isArray(r?.items) ? r.items : [];
    out.push(...itens);
    if (itens.length < 100) break;
  }
  return out;
}

// ── Envio (fila) ──

export type ParametroTexto = { type: "text"; text: string };
export type PedidoEnvioModelo = {
  from: string; to: string; externalId: string; nome: string; idioma: string;
  cabecalho: ParametroTexto[]; corpo: ParametroTexto[];
};
export type MensagemYcloud = { id?: string; wamid?: string; status?: string; totalPrice?: number; currency?: string; externalId?: string };

export async function enfileirarModeloYcloud(c: ChamadaYcloud, p: PedidoEnvioModelo): Promise<MensagemYcloud> {
  const components = [
    ...(p.cabecalho.length ? [{ type: "header", parameters: p.cabecalho }] : []),
    ...(p.corpo.length ? [{ type: "body", parameters: p.corpo }] : []),
  ];
  return chamar<MensagemYcloud>(c, "POST", "/whatsapp/messages", {
    from: p.from, to: p.to, type: "template", externalId: p.externalId,
    // listas de descadastro e bloqueio da própria YCloud (só valem na fila; padrão false)
    filterUnsubscribed: true, filterBlocked: true,
    template: { name: p.nome, language: { code: p.idioma, policy: "deterministic" }, ...(components.length ? { components } : {}) },
  });
}

// ── Aviso de entrega (webhook) ──

export type EndpointYcloud = { id?: string; url?: string; enabledEvents?: string[]; status?: string; secret?: string };

export async function criarEndpointYcloud(c: ChamadaYcloud, url: string, eventos: readonly string[]): Promise<EndpointYcloud> {
  return chamar<EndpointYcloud>(c, "POST", "/webhookEndpoints", {
    url, enabledEvents: [...eventos], description: "Prospecta — situação de entrega das campanhas", status: "active",
  });
}

// ── Descadastro (lista da própria YCloud; complementa o opt-out local) ──

export async function criarDescadastroYcloud(c: ChamadaYcloud, telefoneE164: string): Promise<void> {
  await chamar(c, "POST", "/unsubscribers", { type: "PHONE_NUMBER", customer: telefoneE164, channel: "whatsapp", regionCode: "BR" });
}
