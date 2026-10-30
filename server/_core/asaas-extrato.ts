// Pedido de 25/10: extrato e saldo da conta Asaas pela API (sem custo), para o BPO › Bancos.
// Usa a chave da própria conta bancária cadastrada, independente da configuração de cobranças.
const ASAAS_API = {
  production: "https://api.asaas.com/v3",
  sandbox: "https://sandbox.asaas.com/api/v3",
} as const;

type Fetch = typeof fetch;

export type AsaasMovimento = {
  externalId: string;
  data: string;
  descricao: string;
  valor: number;
  tipo: "credito" | "debito";
  categoria?: string;
  /** Pedido de 25/10 (noite), item 14: id do pagamento (cobrança) que gerou o crédito. */
  asaasPaymentId?: string;
};

function baseUrl(apiKey: string) {
  return apiKey.trim().startsWith("$aact_prod") ? ASAAS_API.production : ASAAS_API.sandbox;
}

/**
 * Lote D/Lote 4: o que o status HTTP do Asaas quer dizer, em português, para a tela.
 * Mesma regra nos dois sistemas (Prospecta server/_core/asaas-extrato.ts · Santa Fé web/src/lib/bancos/asaas-extrato.ts).
 */
export function dicaAsaas(status: number): string {
  if (status === 401) return " Confira se a chave está ativa e se há restrição de IP no Asaas (Integrações › Chave de API).";
  if (status === 403) return " A chave não tem permissão para esta operação — confira as permissões da chave e a restrição de IP no Asaas.";
  if (status === 404) return " Recurso não encontrado no Asaas — confira se a chave é do ambiente certo (produção × sandbox).";
  if (status === 429) return " Limite de requisições do Asaas atingido — tente de novo em alguns minutos.";
  if (status >= 500) return " O Asaas está instável no momento — tente novamente mais tarde.";
  return "";
}

async function getAsaas<T>(apiKey: string, path: string, fetchImpl: Fetch): Promise<T> {
  const res = await fetchImpl(`${baseUrl(apiKey)}${path}`, {
    headers: { access_token: apiKey.trim(), "Content-Type": "application/json", "User-Agent": "Prospecta-BPO" },
  });
  if (!res.ok) {
    // Pedido de 25/10: mostrar o motivo exato devolvido pelo Asaas (ex.: chave inválida, IP não autorizado).
    let detalhe = "";
    try {
      const corpo = (await res.json()) as { errors?: { code?: string; description?: string }[] };
      detalhe = (corpo.errors ?? []).map(e => e.description || e.code).filter(Boolean).join("; ");
    } catch { /* corpo vazio */ }
    throw new Error(`O Asaas recusou o acesso (HTTP ${res.status})${detalhe ? `: ${detalhe}` : ""}.${dicaAsaas(res.status)}`);
  }
  return (await res.json()) as T;
}

export async function fetchAsaasSaldo(apiKey: string, fetchImpl: Fetch = fetch): Promise<number> {
  const data = await getAsaas<{ balance?: number }>(apiKey, "/finance/balance", fetchImpl);
  return Number(data.balance ?? 0);
}

export async function fetchAsaasExtrato(apiKey: string, desde: string, ate: string, fetchImpl: Fetch = fetch): Promise<AsaasMovimento[]> {
  const out: AsaasMovimento[] = [];
  for (let offset = 0, pagina = 0; pagina < 100; pagina++, offset += 100) {
    const q = new URLSearchParams({ startDate: desde, finishDate: ate, offset: String(offset), limit: "100" });
    const data = await getAsaas<{
      hasMore?: boolean;
      data?: { id: string; value: number; date: string; description?: string; type?: string; paymentId?: string | null }[];
    }>(apiKey, `/financialTransactions?${q}`, fetchImpl);
    for (const t of data.data ?? []) {
      out.push({
        ...(t.paymentId ? { asaasPaymentId: t.paymentId } : {}),
        externalId: `asaas:${t.id}`,
        data: t.date,
        descricao: t.description || t.type || "Movimentação Asaas",
        valor: Math.abs(Number(t.value)),
        tipo: Number(t.value) < 0 ? "debito" : "credito",
        categoria: t.type,
      });
    }
    if (!data.hasMore) break;
  }
  return out;
}

// ── Pedido de 25/10 (noite), item 14: cobranças emitidas (GET /payments) ─────────────

export type AsaasCobranca = {
  id: string;
  status: string;
  valor: number;
  valorLiquido: number | null;
  vencimento: string; // AAAA-MM-DD
  pagoEm: string | null; // AAAA-MM-DD
  descricao: string;
  clienteNome: string | null;
  clienteDocumento: string | null;
  clienteAsaasId: string | null;
};

/**
 * Cobranças criadas a partir de `desde` (todas as situações). Nome e CPF/CNPJ do cliente só são
 * buscados para as cobranças em que `precisaCliente` responder sim (evita uma chamada por cliente
 * a cada sincronização).
 */
export async function fetchAsaasCobrancas(
  apiKey: string,
  desde: string,
  fetchImpl: Fetch = fetch,
  precisaCliente: (pagamentoId: string) => boolean | Promise<boolean> = () => true,
): Promise<AsaasCobranca[]> {
  type Pagamento = {
    id: string; status?: string; value?: number; netValue?: number; dueDate?: string; paymentDate?: string | null;
    clientPaymentDate?: string | null; confirmedDate?: string | null; description?: string | null; customer?: string; deleted?: boolean;
  };
  const brutos: Pagamento[] = [];
  for (let offset = 0, pagina = 0; pagina < 100; pagina++, offset += 100) {
    const q = new URLSearchParams({ "dateCreated[ge]": desde, offset: String(offset), limit: "100" });
    const data = await getAsaas<{ hasMore?: boolean; data?: Pagamento[] }>(apiKey, `/payments?${q}`, fetchImpl);
    brutos.push(...(data.data ?? []).filter(p => p && p.id && !p.deleted));
    if (!data.hasMore) break;
  }
  const clientes = new Map<string, { nome: string | null; documento: string | null }>();
  const buscar = new Set<string>();
  for (const p of brutos) if (p.customer && (await precisaCliente(p.id))) buscar.add(p.customer);
  for (const id of Array.from(buscar)) {
    try {
      const c = await getAsaas<{ name?: string; cpfCnpj?: string }>(apiKey, `/customers/${encodeURIComponent(id)}`, fetchImpl);
      clientes.set(id, { nome: c.name?.trim() || null, documento: c.cpfCnpj?.replace(/\D/g, "") || null });
    } catch { clientes.set(id, { nome: null, documento: null }); }
  }
  const dia = (d?: string | null) => (d ? d.slice(0, 10) : null);
  return brutos.map(p => ({
    id: p.id,
    status: String(p.status ?? "").toUpperCase(),
    valor: Math.abs(Number(p.value ?? 0)),
    valorLiquido: p.netValue != null ? Math.abs(Number(p.netValue)) : null,
    vencimento: dia(p.dueDate) ?? new Date().toISOString().slice(0, 10),
    pagoEm: dia(p.clientPaymentDate) ?? dia(p.paymentDate) ?? dia(p.confirmedDate),
    descricao: (p.description ?? "").trim(),
    clienteNome: p.customer ? clientes.get(p.customer)?.nome ?? null : null,
    clienteDocumento: p.customer ? clientes.get(p.customer)?.documento ?? null : null,
    clienteAsaasId: p.customer ?? null,
  }));
}
