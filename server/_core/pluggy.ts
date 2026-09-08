const PLUGGY_API = "https://api.pluggy.ai";

export type PluggyTransaction = {
  externalId: string;
  data: string;
  descricao: string;
  valor: number;
  tipo: "credito" | "debito";
  categoria?: string;
};

export async function authenticatePluggy(clientId: string, clientSecret: string): Promise<string | null> {
  try {
    const res = await fetch(`${PLUGGY_API}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { apiKey: string };
    return data.apiKey ?? null;
  } catch {
    return null;
  }
}

export async function fetchPluggyTransactions(token: string, accountId: string): Promise<PluggyTransaction[]> {
  const res = await fetch(`${PLUGGY_API}/transactions?accountId=${accountId}&pageSize=100`, {
    headers: { "X-API-KEY": token },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results: { id: string; date: string; description: string; amount: number; type: string; category?: string }[];
  };
  return data.results.map((t) => ({
    externalId: t.id,
    data: t.date,
    descricao: t.description,
    valor: Math.abs(t.amount),
    tipo: t.type === "CREDIT" ? "credito" : "debito",
    categoria: t.category,
  }));
}

export async function fetchPluggyAccountBalance(token: string, accountId: string): Promise<number | null> {
  const res = await fetch(`${PLUGGY_API}/accounts/${accountId}`, { headers: { "X-API-KEY": token } });
  if (!res.ok) return null;
  const data = (await res.json()) as { balance: number };
  return data.balance ?? null;
}
