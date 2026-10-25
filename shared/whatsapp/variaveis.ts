// Pedido de 25/10: as variáveis dos templates ({{nome}}, {{servico}}…) são preenchidas por destinatário
// antes do envio. Regra pura, igual no Santa Fé (web/src/lib/whatsapp/variaveis.ts).

export const VARIAVEIS_TEMPLATE: Record<string, string> = {
  nome: "Nome do cliente",
  servico: "Serviço",
  corretor: "Corretor",
  imovel: "Imóvel",
  banco: "Banco",
  horario: "Horário",
  endereco: "Endereço",
  documentos: "Documentos",
};

const PADRAO = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/** Nomes das variáveis usadas no texto, sem repetir, na ordem em que aparecem. */
export function variaveisDoTexto(texto: string): string[] {
  const out: string[] = [];
  for (const m of Array.from(texto.matchAll(PADRAO))) {
    const nome = m[1].toLowerCase();
    if (!out.includes(nome)) out.push(nome);
  }
  return out;
}

/** Troca as variáveis pelos valores; devolve também as que ficaram sem valor (o envio é bloqueado). */
export function preencherTemplate(texto: string, valores: Record<string, string | null | undefined>) {
  const faltando: string[] = [];
  const final = texto.replace(PADRAO, (inteiro, bruto: string) => {
    const nome = bruto.toLowerCase();
    const v = valores[nome]?.toString().trim();
    if (v) return v;
    if (!faltando.includes(nome)) faltando.push(nome);
    return inteiro;
  });
  return { texto: final, faltando };
}

export const primeiroNome = (nome: string | null | undefined) => (nome ?? "").trim().split(/\s+/)[0] ?? "";

/** "a, b e c" */
export function listaPorExtenso(itens: string[]): string {
  const u = Array.from(new Set(itens.filter(Boolean)));
  if (u.length <= 1) return u[0] ?? "";
  return `${u.slice(0, -1).join(", ")} e ${u[u.length - 1]}`;
}
