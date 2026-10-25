// Pedido de 25/10: as variáveis dos templates ({{nome}}, {{servico}}…) são preenchidas por destinatário
// antes do envio. Regra pura, igual no Santa Fé (web/src/lib/whatsapp/variaveis.ts).
import { CLIENT_DOCUMENT_CHECKLIST } from "../client-document-checklist.js";

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

// ── Pedido de 25/10 (noite): {{documentos}} vem do checklist de documentos do lead ──
export const DOCUMENTOS_CHECKLIST = CLIENT_DOCUMENT_CHECKLIST.map(([chave, rotulo]) => ({ chave, rotulo }));
const CONJUGE = new Set(["spouse_docs", "spouse_income_proof"]);

/**
 * Itens do checklist ainda sem arquivo válido (recusado conta como pendente; CNH vale como RG).
 * "Outros" não entra; itens do cônjuge só se o lead tem cônjuge/composição de renda.
 */
export function documentosPendentes(docs: { type: string; status: string; temArquivo: boolean }[], temConjuge: boolean): string[] {
  const recebidos = new Set(docs.filter(d => d.temArquivo && d.status !== "rejected").map(d => (d.type === "cnh" ? "rg" : d.type)));
  return DOCUMENTOS_CHECKLIST.map(d => d.chave as string)
    .filter(c => c !== "other" && (temConjuge || !CONJUGE.has(c)) && !recebidos.has(c));
}

/** Chaves do checklist → "RG ou CNH frente e verso, PIS e Extrato do FGTS" (na ordem do checklist). */
export function textoDocumentos(chaves: string[]): string {
  return listaPorExtenso(DOCUMENTOS_CHECKLIST.filter(d => chaves.includes(d.chave)).map(d => d.rotulo));
}

/**
 * Ordem de precedência dos valores de um destinatário: o que foi escolhido só para ele na tela
 * (porLead) > cadastro (valores) > campo geral da tela (extras, que só completa o que falta).
 */
export function mesclarValores(valores: Record<string, string> | undefined, extras?: Record<string, string>, porLead?: Record<string, string>) {
  const limpo = (o?: Record<string, string>) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === "string" && v.trim()));
  return { ...limpo(extras), ...limpo(valores), ...limpo(porLead) };
}
