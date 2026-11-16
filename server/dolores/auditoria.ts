// EPIC-025 (Dolores, etapa 1) — auditoria: uma linha em `dolores_acoes` por chamada à ponte, no nome da Dolores.
// Guarda os argumentos saneados e o resumo em contagens (nunca os dados devolvidos). Falha ao gravar NUNCA derruba
// a leitura: vai para o log do servidor e a resposta segue.
import { createHash } from "node:crypto";
import { doloresAcoes } from "../../drizzle/schema-dolores.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { getDb } from "../db.js";
import { erroParaLog } from "./erro-seguro.js";
import { ETAPA_ATUAL } from "./permissoes.js";

export type ResultadoAcao = "ok" | "recusada" | "erro";
export type Acao = {
  funcao: string; argumentos?: unknown; resultado: ResultadoAcao; motivo?: string | null;
  resumo?: Record<string, unknown> | null; duracaoMs?: number | null; pedidoId?: string | null; autorUserId: number | null;
  /** Por onde chegou: a ponte HTTP (etapa 1) ou o WhatsApp do dono (etapa 2). */
  canal?: "ponte" | "whatsapp";
};

const CHAVE_SENSIVEL = /token|senha|password|secret|segredo|chave|apikey|api_key|authorization|cpf|cnpj|conta|agencia|pix/i;
const MAX_ARGUMENTOS = 2000;
/** Termo de busca (nome, telefone, CPF) é dado pessoal: a auditoria guarda só um resumo (hash curto) e o tamanho. */
const CHAVE_BUSCA = /^(busca|nome|telefone|termo)$/i;
export function resumoDoTermo(termo: string) {
  const t = termo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  return { hash: createHash("sha256").update(t).digest("hex").slice(0, 12), tamanho: termo.length };
}

/** Argumentos para o registro: chaves sensíveis trocadas por "[omitido]", textos e listas cortados, tamanho limitado. */
export function sanearArgumentos(v: unknown, nivel = 0): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === "string") {
    // filtro de dados pessoais + qualquer sequência longa de dígitos restante (só os 2 últimos)
    const s = sanitizarTexto(v).replace(/\d[\d.,\-/ ]{6,}\d/g, m => {
      const d = m.replace(/\D/g, "");
      return d.length >= 8 ? `***${d.slice(-2)}` : m;
    });
    return s.length > 120 ? `${s.slice(0, 119)}…` : s;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (nivel >= 3) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 20).map(x => sanearArgumentos(x, nivel + 1));
  if (typeof v === "object") {
    const r: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30))
      r[k.slice(0, 60)] = CHAVE_SENSIVEL.test(k) ? "[omitido]" : CHAVE_BUSCA.test(k) && typeof x === "string" ? resumoDoTermo(x) : sanearArgumentos(x, nivel + 1);
    return r;
  }
  return String(v).slice(0, 120);
}

function limitado(v: unknown) {
  const s = JSON.stringify(v ?? null);
  return s.length > MAX_ARGUMENTOS ? { cortado: true, inicio: s.slice(0, MAX_ARGUMENTOS - 100) } : v ?? null;
}

/** Grava a ação. Nunca lança: devolve false e registra no log quando o banco recusa. */
export async function registrarAcao(a: Acao): Promise<boolean> {
  try {
    await getDb().insert(doloresAcoes).values({
      funcao: a.funcao.slice(0, 80) || "(vazia)",
      argumentos: limitado(sanearArgumentos(a.argumentos)),
      resultado: a.resultado,
      motivo: a.motivo ? sanitizarTexto(a.motivo).slice(0, 300) : null,
      resumo: limitado(a.resumo ?? null),
      duracaoMs: a.duracaoMs == null ? null : Math.max(0, Math.round(a.duracaoMs)),
      pedidoId: a.pedidoId ? a.pedidoId.slice(0, 120) : null,
      autorUserId: a.autorUserId,
      canal: a.canal ?? "ponte",
      etapa: ETAPA_ATUAL,
    });
    return true;
  } catch (e) {
    console.error("[dolores/auditoria] falha ao gravar a ação", a.funcao.slice(0, 80), erroParaLog(e));
    return false;
  }
}
